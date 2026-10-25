// Host tools for the in-extension agent. They run on the machine that runs the daemon, through the bridge.
// When the bridge is not connected the action fails with a clear message; nothing runs locally.
import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { McpBridgeHostMethod } from '@extension/shared';
import { hostRequest } from '../../services/mcpBridge/hostRelay';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { Action } from './action';
import { clipText } from './shared';
import type { ActionSchema } from './schemas';
import {
  fsListActionSchema,
  fsReadActionSchema,
  fsSearchActionSchema,
  fsWriteActionSchema,
  shellExecActionSchema,
} from './schemas';

const HOST_RESULT_MAX_CHARS = 20000;

interface HostActionSpec {
  method: McpBridgeHostMethod;
  label: string;
  schema: ActionSchema;
}

/** One action per host tool. `intent` is for the side panel only and is not sent to the daemon. */
function createHostAction(context: AgentContext, spec: HostActionSpec) {
  return new Action(async (input: { intent?: string } & Record<string, unknown>) => {
    const { intent, ...params } = input;
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent || t('act_host_start', [spec.label]));
    try {
      const result = await hostRequest(spec.method, params);
      const msg = t('act_host_ok', [spec.label]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      // Command output and file contents are external text: wrapped before they reach the model.
      const body = wrapUntrustedContent(clipText(JSON.stringify(result, null, 2), HOST_RESULT_MAX_CHARS));
      return new ActionResult({ extractedContent: `${msg}\n${body}`, includeInMemory: true });
    } catch (error) {
      const msg = t('act_host_fail', [spec.label]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      const reason = error instanceof Error ? error.message : String(error);
      return new ActionResult({ error: `${msg}: ${reason}`, includeInMemory: true });
    }
  }, spec.schema);
}

export function createShellExecAction(context: AgentContext) {
  return createHostAction(context, { method: 'shell_exec', label: 'shell_exec', schema: shellExecActionSchema });
}

export function createFsReadAction(context: AgentContext) {
  return createHostAction(context, { method: 'fs_read', label: 'fs_read', schema: fsReadActionSchema });
}

export function createFsWriteAction(context: AgentContext) {
  return createHostAction(context, { method: 'fs_write', label: 'fs_write', schema: fsWriteActionSchema });
}

export function createFsListAction(context: AgentContext) {
  return createHostAction(context, { method: 'fs_list', label: 'fs_list', schema: fsListActionSchema });
}

export function createFsSearchAction(context: AgentContext) {
  return createHostAction(context, { method: 'fs_search', label: 'fs_search', schema: fsSearchActionSchema });
}
