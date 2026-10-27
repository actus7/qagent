import { generateText } from 'ai';
import { runWithFailover } from '../agent/model-failover';
import { Actors, chatHistoryStore, type ChatMessage } from '@extension/storage';
import { t } from '@extension/i18n';
import type { ChatModel } from '../agent/helper';

// Characters of chat sent to the model per call; the older part of a long chat is replaced by a summary once it grows past this.
const CONTEXT_CHAR_BUDGET = 24000;
const MAX_TRANSCRIPT_CHARS = 40000;
const MAX_MESSAGE_CHARS = 12000;
export const COMPACTION_KIND = 'compaction';

const COMPACTION_INSTRUCTIONS = [
  'You compress a conversation between a user and a browser assistant.',
  'Write a faithful summary in the same language the user writes in.',
  'Keep the user goals, decisions, facts from the pages they discussed, open questions, and any unfinished work.',
  'Do not add facts that are not in the conversation. Output only the summary.',
].join(' ');

const isDialogMessage = (message: ChatMessage): boolean =>
  (message.actor === Actors.USER || message.actor === Actors.ASSISTANT) && message.kind !== COMPACTION_KIND;

/** The newest summary (if any) plus the dialog messages that came after it. */
export function selectContext(messages: ChatMessage[]): { summary: string | null; recent: ChatMessage[] } {
  let lastCompaction = -1;
  messages.forEach((message, index) => {
    if (message.kind === COMPACTION_KIND) lastCompaction = index;
  });
  return {
    summary: lastCompaction >= 0 ? messages[lastCompaction].content : null,
    recent: messages.slice(lastCompaction + 1).filter(isDialogMessage),
  };
}

/** Keeps the newest messages that fit the budget. The newest message is always kept. */
export function trimToBudget(messages: ChatMessage[], budget = CONTEXT_CHAR_BUDGET): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let total = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    total += messages[index].content.length;
    if (total > budget && kept.length > 0) break;
    kept.unshift(messages[index]);
  }
  return kept;
}

export function needsAutoCompaction(messages: ChatMessage[], budget = CONTEXT_CHAR_BUDGET): boolean {
  const { summary, recent } = selectContext(messages);
  const size = recent.reduce((total, message) => total + message.content.length, summary?.length ?? 0);
  return size > budget;
}

function buildTranscript(summary: string | null, recent: ChatMessage[]): string {
  const lines = trimToBudget(recent, MAX_TRANSCRIPT_CHARS).map(
    message =>
      `${message.actor === Actors.USER ? 'User' : 'Assistant'}: ${message.content.slice(0, MAX_MESSAGE_CHARS)}`,
  );
  const previous = summary ? `Earlier summary:\n${summary}\n\n` : '';
  return `${previous}Messages to fold into the summary:\n${lines.join('\n\n')}`;
}

/**
 * Asks the model to summarize the chat since the last summary and stores the result as a compaction message.
 * The full history stays in storage (and in the UI); only what is sent to the model is replaced.
 * @returns false when there is nothing new to summarize.
 */
export async function compactChatConversation(taskId: string, model: ChatModel): Promise<boolean> {
  const session = await chatHistoryStore.getSession(taskId);
  const { summary, recent } = selectContext(session?.messages ?? []);
  if (recent.length === 0) return false;

  const prompt = buildTranscript(summary, recent);
  const response = await runWithFailover(
    model,
    current =>
      generateText({
        model: current.model,
        ...current.settings,
        instructions: COMPACTION_INSTRUCTIONS,
        prompt,
        maxRetries: 0,
      }),
    { shouldTryNext: () => true },
  );
  const text = response.text.trim();
  if (!text) throw new Error(t('bg_compact_empty'));

  await chatHistoryStore.addMessage(taskId, {
    actor: Actors.SYSTEM,
    kind: COMPACTION_KIND,
    content: text,
    timestamp: Date.now(),
  });
  return true;
}

/** Compacts only when the context sent to the model would exceed the budget. */
export async function compactIfNeeded(taskId: string, model: ChatModel): Promise<boolean> {
  const session = await chatHistoryStore.getSession(taskId);
  if (!needsAutoCompaction(session?.messages ?? [])) return false;
  return compactChatConversation(taskId, model);
}
