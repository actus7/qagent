import { z } from 'zod';
import { MCP_BRIDGE_METHODS, type McpBridgeMethod } from '@extension/shared';

// Everything arriving over the bridge socket is untrusted: every frame is validated here before any work starts.
const MAX_TASK_CHARS = 8000;
const MAX_URL_CHARS = 2048;
const MAX_ID_CHARS = 128;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const runTaskParamsSchema = z
  .object({
    task: z.string().trim().min(1).max(MAX_TASK_CHARS),
    mode: z.enum(['chat', 'plan', 'act']).default('act'),
    // "plan" permission is a panel-only flow; MCP clients get the two modes the spec allows.
    permission: z.enum(['ask', 'auto']).default('ask'),
    url: z
      .string()
      .trim()
      .max(MAX_URL_CHARS)
      .refine(isHttpUrl, 'url must be an http or https address')
      .optional(),
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

/** 'auto' from an MCP client only takes effect when the user allowed it in the MCP settings; otherwise 'ask'. */
export function resolveBridgePermission(requested: 'ask' | 'auto', allowAutoPermission: boolean): 'ask' | 'auto' {
  return requested === 'auto' && allowAutoPermission ? 'auto' : 'ask';
}

export type ParsedBridgeRequest =
  | { id: string; method: 'run_task'; params: RunTaskParams }
  | { id: string; method: 'list_tabs' | 'get_status' | 'cancel_task'; params: Record<string, never> };

export class McpBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpBridgeError';
  }
}

const PARAM_SCHEMAS: Record<Exclude<McpBridgeMethod, 'run_task'>, z.ZodType> = {
  list_tabs: emptyParamsSchema,
  get_status: emptyParamsSchema,
  cancel_task: emptyParamsSchema,
};

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
  const parsed = PARAM_SCHEMAS[method].safeParse(params);
  if (!parsed.success) {
    throw new McpBridgeError('INVALID_PARAMS', `Unexpected parameters for ${method}`);
  }
  return { id, method, params: {} };
}
