// Host-tool requests from agent actions reach the daemon through this relay. The socket client registers
// itself at startup, so the agent action graph does not import the browser-only socket code.
import { t } from '@extension/i18n';
import type { McpBridgeHostMethod } from '@extension/shared';
import { McpBridgeError } from './protocol';

export type HostRequester = (
  method: McpBridgeHostMethod,
  params: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

let requester: HostRequester | null = null;

export function setHostRequester(next: HostRequester | null): void {
  requester = next;
}

export function hostRequest<T = unknown>(
  method: McpBridgeHostMethod,
  params: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T> {
  if (!requester) return Promise.reject(new McpBridgeError('BRIDGE_NOT_CONNECTED', t('bg_mcp_notConnected')));
  return requester(method, params, timeoutMs) as Promise<T>;
}
