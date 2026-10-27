import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';
import type { BaseStorage } from '../base/types';
import type {
  ChatSession,
  ChatMessage,
  ChatHistoryStorage,
  Message,
  ChatSessionMetadata,
  ChatAgentStepHistory,
} from './types';

// Key for storing chat session metadata
const CHAT_SESSIONS_META_KEY = 'chat_sessions_meta';
const EMPTY_AGENT_STEP_HISTORY: ChatAgentStepHistory = {
  task: '',
  history: '',
  timestamp: 0,
};

// Create storage for session metadata
const chatSessionsMetaStorage = createStorage<ChatSessionMetadata[]>(CHAT_SESSIONS_META_KEY, [], {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

// Messages are stored in fixed-size chunks, so an append rewrites only the last chunk instead of the whole session.
// Sessions written by older versions keep one flat array under chat_messages_<id>; it is converted on first access.
const CHAT_MESSAGE_CHUNK_SIZE = 50;
const getLegacyMessagesKey = (sessionId: string) => `chat_messages_${sessionId}`;
const getMessagesManifestKey = (sessionId: string) => `chat_chunks_manifest_${sessionId}`;
const getMessagesChunkKey = (sessionId: string, index: number) => `chat_chunks_${sessionId}_${index}`;

interface ChatMessagesManifest {
  chunkCount: number;
}

// A write can span several keys and a delete must reach every chunk, so these calls go to chrome.storage.local directly.
const localArea = () => globalThis.chrome?.storage.local;
const readKeys = async (keys: string[]): Promise<Record<string, unknown>> => (await localArea()?.get(keys)) ?? {};
const chunkCountFor = (messageCount: number) => Math.ceil(messageCount / CHAT_MESSAGE_CHUNK_SIZE);
const chunkKeys = (sessionId: string, chunkCount: number) =>
  Array.from({ length: chunkCount }, (_, index) => getMessagesChunkKey(sessionId, index));

// Panel and service worker share an origin, so a Web Lock also serializes cross-context writes and migrations.
const withMessagesLock = <T>(work: () => Promise<T>): Promise<T> =>
  globalThis.navigator?.locks ? navigator.locks.request('qagent-chat-history-write', work) : work();

/** Returns the session's manifest, converting a legacy flat array into chunks the first time. Call under the lock. */
async function loadMessagesManifest(sessionId: string): Promise<ChatMessagesManifest> {
  const manifestKey = getMessagesManifestKey(sessionId);
  const legacyKey = getLegacyMessagesKey(sessionId);
  const stored = await readKeys([manifestKey, legacyKey]);
  const manifest = stored[manifestKey] as ChatMessagesManifest | undefined;
  const legacy = stored[legacyKey];
  if (manifest) {
    // A crash between the conversion's two writes leaves the old key behind; the manifest is the source of truth.
    if (legacy !== undefined) await localArea()?.remove(legacyKey);
    return manifest;
  }
  if (!Array.isArray(legacy)) return { chunkCount: 0 };
  await writeMessagesLayout(sessionId, legacy as ChatMessage[], 0);
  await localArea()?.remove(legacyKey);
  return { chunkCount: chunkCountFor(legacy.length) };
}

/** Replaces the session's messages with full chunks and a manifest in one write, then drops chunks past the new end. */
async function writeMessagesLayout(sessionId: string, messages: ChatMessage[], previousChunkCount: number) {
  const chunkCount = chunkCountFor(messages.length);
  const entries: Record<string, unknown> = { [getMessagesManifestKey(sessionId)]: { chunkCount } };
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * CHAT_MESSAGE_CHUNK_SIZE;
    entries[getMessagesChunkKey(sessionId, index)] = messages.slice(start, start + CHAT_MESSAGE_CHUNK_SIZE);
  }
  await localArea()?.set(entries);
  const stale = chunkKeys(sessionId, previousChunkCount).slice(chunkCount);
  if (stale.length > 0) await localArea()?.remove(stale);
}

/** Reads every message in order. Call under the lock, after loadMessagesManifest. */
async function readChunkedMessages(sessionId: string, chunkCount: number): Promise<ChatMessage[]> {
  const keys = chunkKeys(sessionId, chunkCount);
  const stored = await readKeys(keys);
  return keys.flatMap(key => (stored[key] as ChatMessage[] | undefined) ?? []);
}

/** Appends to the last chunk, or starts a new one when it is full. Call under the lock, after loadMessagesManifest. */
async function appendChunkedMessage(sessionId: string, manifest: ChatMessagesManifest, message: ChatMessage) {
  const lastIndex = manifest.chunkCount - 1;
  if (lastIndex >= 0) {
    const lastKey = getMessagesChunkKey(sessionId, lastIndex);
    const lastChunk = ((await readKeys([lastKey]))[lastKey] as ChatMessage[] | undefined) ?? [];
    if (lastChunk.length < CHAT_MESSAGE_CHUNK_SIZE) {
      await localArea()?.set({ [lastKey]: [...lastChunk, message] });
      return;
    }
  }
  // The new chunk and the manifest go in one write, so the manifest never points at a missing chunk.
  await localArea()?.set({
    [getMessagesChunkKey(sessionId, manifest.chunkCount)]: [message],
    [getMessagesManifestKey(sessionId)]: { chunkCount: manifest.chunkCount + 1 },
  });
}

/** Removes every stored key of a session: chunks, manifest and any legacy array. */
async function removeSessionMessages(sessionId: string): Promise<void> {
  await withMessagesLock(async () => {
    const manifestKey = getMessagesManifestKey(sessionId);
    const stored = await readKeys([manifestKey]);
    const chunkCount = (stored[manifestKey] as ChatMessagesManifest | undefined)?.chunkCount ?? 0;
    await localArea()?.remove([manifestKey, getLegacyMessagesKey(sessionId), ...chunkKeys(sessionId, chunkCount)]);
  });
}

// Helper function to get storage key for a specific session's agent state history
const getSessionAgentStepHistoryKey = (sessionId: string) => `chat_agent_step_${sessionId}`;
const sessionAgentStepHistoryStorageCache = new Map<string, BaseStorage<ChatAgentStepHistory>>();

// Helper function to get storage for a specific session's agent state history
const getSessionAgentStepHistoryStorage = (sessionId: string) => {
  const cachedStorage = sessionAgentStepHistoryStorageCache.get(sessionId);
  if (cachedStorage) return cachedStorage;

  const storage = createStorage<ChatAgentStepHistory>(
    getSessionAgentStepHistoryKey(sessionId),
    EMPTY_AGENT_STEP_HISTORY,
    {
      storageEnum: StorageEnum.Local,
      liveUpdate: false,
    },
  );
  sessionAgentStepHistoryStorageCache.set(sessionId, storage);
  return storage;
};

// Per-session compact memory of the last act task, kept apart from the replay-format agent step history
const getSessionTaskMemoryKey = (sessionId: string) => `chat_task_memory_${sessionId}`;
const sessionTaskMemoryStorageCache = new Map<string, BaseStorage<string>>();

const getSessionTaskMemoryStorage = (sessionId: string) => {
  const cachedStorage = sessionTaskMemoryStorageCache.get(sessionId);
  if (cachedStorage) return cachedStorage;

  const storage = createStorage<string>(getSessionTaskMemoryKey(sessionId), '', {
    storageEnum: StorageEnum.Local,
    liveUpdate: false,
  });
  sessionTaskMemoryStorageCache.set(sessionId, storage);
  return storage;
};

const clearSessionStorageCaches = (sessionId: string) => {
  sessionAgentStepHistoryStorageCache.delete(sessionId);
  sessionTaskMemoryStorageCache.delete(sessionId);
};

const clearAllSessionStorageCaches = () => {
  sessionAgentStepHistoryStorageCache.clear();
  sessionTaskMemoryStorageCache.clear();
};

// Helper function to get current timestamp in milliseconds
const getCurrentTimestamp = (): number => Date.now();

/**
 * Creates a chat history storage instance with optimized operations
 */
export function createChatHistoryStorage(): ChatHistoryStorage {
  return {
    getAllSessions: async (): Promise<ChatSession[]> => {
      const sessionsMeta = await chatSessionsMetaStorage.get();

      // For listing purposes, we can return sessions without loading messages
      // This makes the list view very fast
      return sessionsMeta.map(meta => ({
        ...meta,
        messages: [], // Empty array as we don't load messages for listing
      }));
    },

    clearAllSessions: async (): Promise<void> => {
      const sessionsMeta = await chatSessionsMetaStorage.get();
      for (const sessionMeta of sessionsMeta) {
        await removeSessionMessages(sessionMeta.id);
        const agentStepHistoryStorage = getSessionAgentStepHistoryStorage(sessionMeta.id);
        await agentStepHistoryStorage.set(EMPTY_AGENT_STEP_HISTORY);
        await getSessionTaskMemoryStorage(sessionMeta.id).set('');
        clearSessionStorageCaches(sessionMeta.id);
      }
      clearAllSessionStorageCaches();
      await chatSessionsMetaStorage.set([]);
    },

    // Get session metadata without messages (for UI listing)
    getSessionsMetadata: async (): Promise<ChatSessionMetadata[]> => {
      return await chatSessionsMetaStorage.get();
    },

    getSession: async (sessionId: string): Promise<ChatSession | null> => {
      const sessionsMeta = await chatSessionsMetaStorage.get();
      const sessionMeta = sessionsMeta.find(session => session.id === sessionId);

      if (!sessionMeta) return null;

      // Load messages only when a specific session is requested
      const messages = await withMessagesLock(async () => {
        const manifest = await loadMessagesManifest(sessionId);
        return readChunkedMessages(sessionId, manifest.chunkCount);
      });

      return {
        ...sessionMeta,
        messages,
      };
    },

    createSession: async (title: string): Promise<ChatSession> => {
      const newSessionId = crypto.randomUUID();
      const currentTime = getCurrentTimestamp();
      const newSessionMeta: ChatSessionMetadata = {
        id: newSessionId,
        title,
        createdAt: currentTime,
        updatedAt: currentTime,
        messageCount: 0,
      };

      // Add session metadata to the index
      await chatSessionsMetaStorage.set(prevSessions => [...prevSessions, newSessionMeta]);

      return {
        ...newSessionMeta,
        messages: [],
      };
    },

    updateTitle: async (sessionId: string, title: string): Promise<ChatSessionMetadata> => {
      let updatedSessionMeta: ChatSessionMetadata | undefined;

      // Update the title and capture the updated session in a single pass
      await chatSessionsMetaStorage.set(prevSessions => {
        return prevSessions.map(session => {
          if (session.id === sessionId) {
            // Create the updated session
            const updated = {
              ...session,
              title,
              updatedAt: getCurrentTimestamp(),
            };

            // Capture it for return value
            updatedSessionMeta = updated;

            return updated;
          }
          return session;
        });
      });

      // Check if we found and updated the session
      if (!updatedSessionMeta) {
        throw new Error('Session not found');
      }

      // Return the already captured metadata
      return updatedSessionMeta;
    },

    deleteSession: async (sessionId: string): Promise<void> => {
      // Remove session from metadata
      await chatSessionsMetaStorage.set(prevSessions => prevSessions.filter(session => session.id !== sessionId));

      // Remove the session's messages
      await removeSessionMessages(sessionId);
      const agentStepHistoryStorage = getSessionAgentStepHistoryStorage(sessionId);
      await agentStepHistoryStorage.set(EMPTY_AGENT_STEP_HISTORY);
      await getSessionTaskMemoryStorage(sessionId).set('');
      clearSessionStorageCaches(sessionId);
    },

    addMessage: async (sessionId: string, message: Message): Promise<ChatMessage> => {
      const writeMessage = async (): Promise<ChatMessage> => {
        const newMessage: ChatMessage = {
          ...message,
          id: crypto.randomUUID(),
        };

        // First check if session exists and update metadata in a single operation
        let sessionFound = false;

        await chatSessionsMetaStorage.set(prevSessions => {
          return prevSessions.map(session => {
            if (session.id === sessionId) {
              sessionFound = true;
              return {
                ...session,
                updatedAt: getCurrentTimestamp(),
                messageCount: session.messageCount + 1,
              };
            }
            return session;
          });
        });

        // Throw error if session wasn't found
        if (!sessionFound) {
          throw new Error(`Session with ID ${sessionId} not found`);
        }

        // Only add the message if the session exists. The manifest is read fresh: the panel and the service worker
        // both write messages, and this storage keeps no per-session cache.
        const manifest = await loadMessagesManifest(sessionId);
        await appendChunkedMessage(sessionId, manifest, newMessage);

        return newMessage;
      };
      return withMessagesLock(writeMessage);
    },

    deleteMessage: async (sessionId: string, messageId: string): Promise<void> => {
      const removed = await withMessagesLock(async () => {
        const manifest = await loadMessagesManifest(sessionId);
        const currentMessages = await readChunkedMessages(sessionId, manifest.chunkCount);
        if (!currentMessages.some(msg => msg.id === messageId)) return false;
        await writeMessagesLayout(
          sessionId,
          currentMessages.filter(msg => msg.id !== messageId),
          manifest.chunkCount,
        );
        return true;
      });

      if (!removed) return; // Message not found

      // Update the session's metadata (updatedAt timestamp and messageCount)
      await chatSessionsMetaStorage.set(prevSessions => {
        return prevSessions.map(session => {
          if (session.id === sessionId) {
            return {
              ...session,
              updatedAt: getCurrentTimestamp(),
              messageCount: Math.max(0, session.messageCount - 1),
            };
          }
          return session;
        });
      });
    },

    storeAgentStepHistory: async (sessionId: string, task: string, history: string): Promise<void> => {
      // Check if session exists
      const sessionsMeta = await chatSessionsMetaStorage.get();
      const sessionMeta = sessionsMeta.find(session => session.id === sessionId);
      if (!sessionMeta) {
        throw new Error(`Session with ID ${sessionId} not found`);
      }

      const agentStepHistoryStorage = getSessionAgentStepHistoryStorage(sessionId);
      await agentStepHistoryStorage.set({
        task,
        history,
        timestamp: getCurrentTimestamp(),
      });
    },

    loadAgentStepHistory: async (sessionId: string): Promise<ChatAgentStepHistory | null> => {
      const agentStepHistoryStorage = getSessionAgentStepHistoryStorage(sessionId);
      const history = await agentStepHistoryStorage.get();
      if (!history || !history.task || !history.timestamp || history.history === '' || history.history === '[]')
        return null;
      return history;
    },

    setTaskMemory: async (sessionId: string, memory: string): Promise<void> => {
      await getSessionTaskMemoryStorage(sessionId).set(memory);
    },

    getTaskMemory: async (sessionId: string): Promise<string | null> => {
      const memory = await getSessionTaskMemoryStorage(sessionId).get();
      return memory || null;
    },
  };
}

// Export the storage instance for direct use
export const chatHistoryStore = createChatHistoryStorage();
