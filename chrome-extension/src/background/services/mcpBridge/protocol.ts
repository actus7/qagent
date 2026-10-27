import { z } from 'zod';
import { MCP_BRIDGE_METHODS, type McpBridgeMethod, type McpBridgeResponseFrame } from '@extension/shared';

// Everything arriving over the bridge socket is untrusted: every frame is validated here before any work starts.
const MAX_TASK_CHARS = 8000;
const MAX_URL_CHARS = 2048;
const MAX_ID_CHARS = 128;
const MAX_ACTION_NAME_CHARS = 64;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const runTaskParamsSchema = z
  .object({
    task: z.string().trim().min(1).max(MAX_TASK_CHARS),
    mode: z.enum(['chat', 'plan', 'act']).default('act'),
    url: z.string().trim().max(MAX_URL_CHARS).refine(isHttpUrl, 'url must be an http or https address').optional(),
  })
  .strict();

const runActionParamsSchema = z
  .object({
    action: z
      .string()
      .min(1)
      .max(MAX_ACTION_NAME_CHARS)
      .regex(/^[a-z][a-z0-9_]*$/, 'action must be a lowercase action name'),
    input: z.record(z.string(), z.unknown()).default({}),
    tabId: z.number().int().positive().optional(),
  })
  .strict();

const emptyParamsSchema = z.object({}).strict();

const requestFrameSchema = z
  .object({
    type: z.literal('request'),
    id: z.string().min(1).max(MAX_ID_CHARS),
    method: z.enum(MCP_BRIDGE_METHODS),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type RunTaskParams = z.infer<typeof runTaskParamsSchema>;
export type RunActionParams = z.infer<typeof runActionParamsSchema>;

export type ParsedBridgeRequest =
  | { id: string; method: 'run_task'; params: RunTaskParams }
  | { id: string; method: 'run_action'; params: RunActionParams }
  | { id: string; method: 'list_tabs' | 'get_status' | 'cancel_task' | 'list_actions'; params: Record<string, never> };

export class McpBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpBridgeError';
  }
}

const EMPTY_PARAM_METHODS = ['list_tabs', 'get_status', 'cancel_task', 'list_actions'] as const;

/** Returns the request id when the frame carries a usable one, so an error can still be answered. */
export function extractRequestId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS ? id : null;
}

/** Validates one inbound JSON text frame. Throws McpBridgeError(INVALID_REQUEST) for anything unexpected. */
export function parseBridgeRequest(text: string): ParsedBridgeRequest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new McpBridgeError('INVALID_REQUEST', 'Frame is not valid JSON');
  }
  const frame = requestFrameSchema.safeParse(json);
  if (!frame.success) {
    throw new McpBridgeError('INVALID_REQUEST', 'Unsupported or malformed request frame');
  }
  const { id, method, params } = frame.data;
  if (method === 'run_task') {
    const parsed = runTaskParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new McpBridgeError('INVALID_PARAMS', parsed.error.issues.map(issue => issue.message).join('; '));
    }
    return { id, method, params: parsed.data };
  }
  if (method === 'run_action') {
    const parsed = runActionParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new McpBridgeError('INVALID_PARAMS', parsed.error.issues.map(issue => issue.message).join('; '));
    }
    return { id, method, params: parsed.data };
  }
  if (!(EMPTY_PARAM_METHODS as readonly McpBridgeMethod[]).includes(method)) {
    throw new McpBridgeError('INVALID_REQUEST', `Unsupported method: ${method}`);
  }
  const parsed = emptyParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new McpBridgeError('INVALID_PARAMS', `Unexpected parameters for ${method}`);
  }
  return { id, method: method as 'list_tabs' | 'get_status' | 'cancel_task' | 'list_actions', params: {} };
}

export type { McpBridgeResponseFrame };
