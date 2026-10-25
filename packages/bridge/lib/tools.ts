import type { McpBridgeMethod } from './protocol';
import type { McpToolDefinition, McpToolHost, McpToolResult } from './jsonrpc';

export interface BridgeRequester {
  request(method: McpBridgeMethod, params: Record<string, unknown>): Promise<unknown>;
}

/** One browser action as the extension describes it (list_actions). */
export interface ActionCatalogEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MAX_TASK_CHARS = 8000;
const MODES = ['chat', 'plan', 'act'] as const;
export const ACTION_TOOL_PREFIX = 'page_';

export const QAGENT_TOOLS: McpToolDefinition[] = [
  {
    name: 'qagent_run_task',
    description:
      'Run a task in QAgent in the browser and wait for it to finish. Returns the final answer and a step summary.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', minLength: 1, maxLength: MAX_TASK_CHARS, description: 'What the agent should do.' },
        mode: {
          type: 'string',
          enum: [...MODES],
          default: 'act',
          description: 'chat answers from the selected page; plan proposes steps; act performs them in the browser.',
        },
        url: {
          type: 'string',
          description: 'Optional http(s) URL to open in a new tab first. Otherwise the active tab is used.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'qagent_list_tabs',
    description:
      'List the browser tabs (http and https) with their id, title, redacted URL and whether QAgent may use them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'qagent_get_status',
    description:
      'Report whether QAgent is connected, busy, has the side panel open, and whether enterprise restrictions apply.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'qagent_cancel_task',
    description: 'Cancel the task that is running in QAgent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T, field: string): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
}

/** Early, human-readable checks for tool arguments. The extension validates again with zod. */
export function validateRunTaskArgs(args: Record<string, unknown>): Record<string, unknown> {
  const task = requireString(args.task, 'task').trim();
  if (task.length === 0 || task.length > MAX_TASK_CHARS) {
    throw new Error(`task must have 1 to ${MAX_TASK_CHARS} characters`);
  }
  const params: Record<string, unknown> = {
    task,
    mode: pickEnum(args.mode, MODES, 'act', 'mode'),
  };
  if (args.url !== undefined) {
    const url = requireString(args.url, 'url').trim();
    let protocol: string;
    try {
      protocol = new URL(url).protocol;
    } catch {
      throw new Error('url must be a valid URL');
    }
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error('url must be http or https');
    params.url = url;
  }
  return params;
}

/** MCP tools for each browser action. The tool schema adds an optional tabId; the rest is the action input. */
export function actionTools(entries: ActionCatalogEntry[]): {
  tools: McpToolDefinition[];
  actionByTool: Map<string, string>;
} {
  const actionByTool = new Map<string, string>();
  const tools = entries.map(entry => {
    // page_info stays page_info; click becomes page_click. The action name itself is what run_action takes.
    const name = entry.name.startsWith(ACTION_TOOL_PREFIX) ? entry.name : `${ACTION_TOOL_PREFIX}${entry.name}`;
    actionByTool.set(name, entry.name);
    const properties = (entry.inputSchema.properties ?? {}) as Record<string, unknown>;
    return {
      name,
      description: entry.description,
      inputSchema: {
        ...entry.inputSchema,
        properties: {
          ...properties,
          tabId: { type: 'integer', minimum: 1, description: 'Tab to act on. Defaults to the active tab.' },
        },
      },
    };
  });
  return { tools, actionByTool };
}

export function isActionCatalogEntry(value: unknown): value is ActionCatalogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<Record<keyof ActionCatalogEntry, unknown>>;
  return (
    typeof entry.name === 'string' &&
    typeof entry.description === 'string' &&
    typeof entry.inputSchema === 'object' &&
    entry.inputSchema !== null &&
    !Array.isArray(entry.inputSchema)
  );
}

function parseCatalog(value: unknown): ActionCatalogEntry[] {
  const actions = (value as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(actions)) return [];
  return actions.filter(isActionCatalogEntry);
}

/** True when the page tool list would change: a first load, or any difference in the action list. */
export function catalogChanged(previous: ActionCatalogEntry[] | null, next: ActionCatalogEntry[]): boolean {
  return previous === null || JSON.stringify(previous) !== JSON.stringify(next);
}

export const EXTENSION_NOT_CONNECTED_MESSAGE =
  'extension not connected: open Chrome with the QAgent extension and make sure the bridge is paired';

function isExtensionNotConnected(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('EXTENSION_NOT_CONNECTED');
}

export interface ActionToolsOptions {
  /** Last-known action list, read from disk, so page tools exist before the extension connects. */
  cachedCatalog?: ActionCatalogEntry[] | null;
  /** Persists each action list the extension returns. */
  saveCatalog?: (entries: ActionCatalogEntry[]) => void;
}

export interface QAgentToolHost extends McpToolHost {
  /** Asks the extension for its actions. Resolves true when the page tool list changed. */
  refreshActions(): Promise<boolean>;
}

function textResult(text: string, isError = false): McpToolResult {
  return isError ? { isError: true, content: [{ type: 'text', text }] } : { content: [{ type: 'text', text }] };
}

const TOOL_METHODS: Record<string, McpBridgeMethod> = {
  qagent_list_tabs: 'list_tabs',
  qagent_get_status: 'get_status',
  qagent_cancel_task: 'cancel_task',
};

/**
 * Maps MCP tool calls onto bridge requests. The browser action tools are loaded from the extension on first use,
 * and retried until the extension answers. Bridge failures become tool errors, not protocol errors.
 */
export function createQaAgentToolHost(bridge: BridgeRequester, options: ActionToolsOptions = {}): QAgentToolHost {
  let catalog: ActionCatalogEntry[] | null = options.cachedCatalog ?? null;
  // The cached list is only a stand-in until the extension answers once in this process.
  let live = false;

  async function refreshActions(): Promise<boolean> {
    let entries: ActionCatalogEntry[];
    try {
      entries = parseCatalog(await bridge.request('list_actions', {}));
    } catch {
      // The extension is not connected yet; the last-known list stays and the next call retries.
      return false;
    }
    const changed = catalogChanged(catalog, entries);
    catalog = entries;
    live = true;
    if (changed) options.saveCatalog?.(entries);
    return changed;
  }

  async function runAction(action: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const { tabId, ...input } = args;
    try {
      const result = (await bridge.request('run_action', {
        action,
        input,
        ...(typeof tabId === 'number' ? { tabId } : {}),
      })) as { ok?: boolean } | undefined;
      return textResult(JSON.stringify(result, null, 2), result?.ok === false);
    } catch (error) {
      if (isExtensionNotConnected(error)) return textResult(EXTENSION_NOT_CONNECTED_MESSAGE, true);
      return textResult(error instanceof Error ? error.message : 'QAgent tool failed', true);
    }
  }

  return {
    refreshActions,
    async listTools() {
      if (!live) await refreshActions();
      return [...QAGENT_TOOLS, ...actionTools(catalog ?? []).tools];
    },
    async callTool(name, args) {
      if (!live) await refreshActions();
      const action = actionTools(catalog ?? []).actionByTool.get(name);
      if (action) return runAction(action, args);
      try {
        const method = name === 'qagent_run_task' ? 'run_task' : TOOL_METHODS[name];
        const params = method === 'run_task' ? validateRunTaskArgs(args) : {};
        const result = await bridge.request(method, params);
        return textResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return textResult(error instanceof Error ? error.message : 'QAgent tool failed', true);
      }
    },
  };
}
