import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import {
  browserPluginsStore,
  parsePlugin,
  PluginValidationError,
  type BrowserPlugin,
  type BrowserPluginInput,
} from '@extension/storage';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { buildToolScript, checkToolArgs } from '../../plugins/runner';
import { describePlugin } from '../../plugins/context';
import { Action } from './action';
import { engineUnsupportedResult } from './shared';
import { callPluginToolActionSchema, listPluginsActionSchema, savePluginActionSchema } from './schemas';

/** Plugins are addressed by id or by name; disabled plugins cannot run. */
function findEnabledPlugin(plugins: BrowserPlugin[], ref: string): BrowserPlugin | undefined {
  return plugins.find(plugin => plugin.enabled && (plugin.id === ref || plugin.name === ref));
}

export function createCallPluginToolAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof callPluginToolActionSchema.schema>) => {
    const intent = input.intent || t('act_callPluginTool_start', [input.plugin, input.tool]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    // Resolved at run time, so a plugin saved earlier in the same task can be called right away.
    const plugin = findEnabledPlugin(await browserPluginsStore.getAll(), input.plugin);
    const tool = plugin?.tools.find(item => item.name === input.tool);
    if (!plugin || !tool) {
      const msg = t('act_callPluginTool_notFound', [input.plugin, input.tool]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    const checked = checkToolArgs(tool, input.args);
    if (!checked.ok) {
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, t('act_callPluginTool_invalidArgs', [tool.name]));
      return new ActionResult({ error: checked.error, includeInMemory: true });
    }

    const page = await context.browserContext.getCurrentPage();
    if (!page.evaluateScript) return engineUnsupportedResult(context);
    const outcome = await page.evaluateScript(buildToolScript(tool, checked.args));
    // Plugin output comes from the page, so it is untrusted; a thrown error is a result for the agent, not a crash.
    const msg = outcome.ok
      ? t('act_callPluginTool_ok', [plugin.name, tool.name])
      : t('act_callPluginTool_fail', [plugin.name, tool.name]);
    context.emitEvent(Actors.NAVIGATOR, outcome.ok ? ExecutionState.ACT_OK : ExecutionState.ACT_FAIL, msg);
    return new ActionResult({
      extractedContent: `${msg}\n${wrapUntrustedContent(outcome.text)}`,
      includeInMemory: true,
    });
  }, callPluginToolActionSchema);
}

export function createListPluginsAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof listPluginsActionSchema.schema>) => {
    const intent = input.intent || t('act_listPlugins_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const enabled = (await browserPluginsStore.getAll()).filter(plugin => plugin.enabled);
    if (enabled.length === 0) {
      const msg = t('act_listPlugins_none');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }
    const msg = t('act_listPlugins_ok', [enabled.length.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    return new ActionResult({
      extractedContent: `${msg}\n${enabled.flatMap(describePlugin).join('\n')}`,
      includeInMemory: true,
    });
  }, listPluginsActionSchema);
}

export function createSavePluginAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof savePluginActionSchema.schema>) => {
    const intent = input.intent || t('act_savePlugin_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    let draft: BrowserPluginInput;
    try {
      draft = parsePlugin(input.plugin);
    } catch (error) {
      if (!(error instanceof PluginValidationError)) throw error;
      // The validation message goes back to the agent so it can fix the plugin and try again.
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, t('act_savePlugin_fail'));
      return new ActionResult({ error: `Invalid plugin: ${error.message}`, includeInMemory: true });
    }

    const now = Date.now();
    const existing = draft.id ? await browserPluginsStore.getPlugin(draft.id) : undefined;
    // A user's plugin is never overwritten by the agent: the edit becomes an agent-owned copy.
    const target = existing?.createdBy === 'user' ? undefined : existing;
    const plugin: BrowserPlugin = {
      ...draft,
      id: target?.id ?? crypto.randomUUID(),
      enabled: target?.enabled ?? true,
      createdBy: 'agent',
      createdAt: target?.createdAt ?? now,
      updatedAt: now,
    };
    await browserPluginsStore.save(plugin);

    const msg = t('act_savePlugin_ok', [plugin.name]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    const toolNames = plugin.tools.map(tool => tool.name).join(', ') || '-';
    return new ActionResult({
      extractedContent: `${msg}\nid: ${plugin.id}\ntools: ${toolNames}`,
      includeInMemory: true,
    });
  }, savePluginActionSchema);
}
