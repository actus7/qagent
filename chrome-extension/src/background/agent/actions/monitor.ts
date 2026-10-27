import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import type { MonitorRecord } from '../../services/monitor-logic';
import { awaitMonitor, getMonitor, listMonitors, startMonitor, stopMonitor } from '../../services/monitors';
import { Action } from './action';
import { actionErrorResult, actionFailedResult } from './shared';
import {
  awaitMonitorActionSchema,
  monitorStatusActionSchema,
  startMonitorActionSchema,
  stopMonitorActionSchema,
} from './schemas';

function describeMonitor(record: MonitorRecord): string {
  const changed = record.status === 'changed' ? ` changed: ${wrapUntrustedContent(record.changedText)}` : '';
  return `- ${record.id} [${record.status}] ${record.selector}${changed}`;
}

async function unknownMonitor(context: AgentContext, id: string): Promise<ActionResult> {
  const msg = t('act_monitor_unknown', [id]);
  return actionErrorResult(context, msg);
}

export function createStartMonitorAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof startMonitorActionSchema.schema>) => {
    const intent = input.intent || t('act_monitor_start', [input.selector]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    try {
      const page = await context.browserContext.getCurrentPage();
      const record = await startMonitor(page.tabId, input.selector, input.timeout_minutes);
      const msg = t('act_monitor_started', [record.id, wrapUntrustedContent(input.selector)]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, startMonitorActionSchema);
}

export function createMonitorStatusAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof monitorStatusActionSchema.schema>) => {
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, input.intent || t('act_monitor_status_start'));
    const records = await listMonitors();
    const msg = records.length ? records.map(describeMonitor).join('\n') : t('act_monitor_none');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, t('act_monitor_status_ok'));
    return new ActionResult({ extractedContent: msg, includeInMemory: true });
  }, monitorStatusActionSchema);
}

export function createAwaitMonitorAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof awaitMonitorActionSchema.schema>) => {
    const intent = input.intent || t('act_monitor_await_start', [input.id]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    try {
      const record = await awaitMonitor(input.id, input.timeout_ms);
      if (!record) return unknownMonitor(context, input.id);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, t('act_monitor_status_ok'));
      return new ActionResult({ extractedContent: describeMonitor(record), includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, awaitMonitorActionSchema);
}

export function createStopMonitorAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof stopMonitorActionSchema.schema>) => {
    const intent = input.intent || t('act_monitor_stop_start', [input.id]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    try {
      if (!(await getMonitor(input.id))) return unknownMonitor(context, input.id);
      const record = await stopMonitor(input.id);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, t('act_monitor_stop_ok', [input.id]));
      return new ActionResult({ extractedContent: record ? describeMonitor(record) : '', includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, stopMonitorActionSchema);
}
