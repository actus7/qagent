import type { McpBridgeMethod } from '@extension/shared';
import type { McpToolDefinition, McpToolHost, McpToolResult } from './jsonrpc';

export interface BridgeRequester {
  request(method: McpBridgeMethod, params: Record<string, unknown>): Promise<unknown>;
}

const MAX_TASK_CHARS = 8000;
const MODES = ['chat', 'plan', 'act'] as const;
const PERMISSIONS = ['ask', 'auto'] as const;

export const QAGENT_TOOLS: McpToolDefinition[] = [
  {
    name: 'qagent_run_task',
    description:
      'Run a task in QAgent in the browser and wait for it to finish. Returns the final answer and a step summary. ' +
      'Ask permission sends each sensitive or page-changing action to the side panel for approval, so the panel must be open.',
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
        permission: {
          type: 'string',
          enum: [...PERMISSIONS],
          default: 'ask',
          description: 'ask: approve each action in the side panel. auto: run without asking (may be forbidden by policy).',
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
    description: 'List the browser tabs (http and https) with their id, title, redacted URL and whether QAgent may use them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'qagent_get_status',
    description: 'Report whether QAgent is connected, busy, has the side panel open, and whether enterprise restrictions apply.',
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
    permission: pickEnum(args.permission, PERMISSIONS, 'ask', 'permission'),
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

function textResult(text: string, isError = false): McpToolResult {
  return isError ? { isError: true, content: [{ type: 'text', text }] } : { content: [{ type: 'text', text }] };
}

const TOOL_METHODS: Record<string, McpBridgeMethod> = {
  qagent_list_tabs: 'list_tabs',
  qagent_get_status: 'get_status',
  qagent_cancel_task: 'cancel_task',
};

/** Maps MCP tool calls onto bridge requests. Bridge failures become tool errors, not protocol errors. */
export function createQaAgentToolHost(bridge: BridgeRequester): McpToolHost {
  return {
    listTools: () => QAGENT_TOOLS,
    async callTool(name, args) {
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
