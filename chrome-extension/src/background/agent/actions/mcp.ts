import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import { mcpServersStore, type McpServer } from '@extension/storage';
import { callMcpTool, listMcpTools, McpClientError } from '@extension/shared';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { wrapUntrustedContent } from '../messages/utils';
import { Action } from './action';
import { clipText } from './shared';
import { callMcpToolActionSchema, listMcpToolsActionSchema } from './schemas';

const MCP_RESULT_MAX_CHARS = 8000;
const MCP_DESCRIPTION_MAX_CHARS = 200;

/** Servers are addressed by id or by name; disabled servers cannot be called. */
function findEnabledServer(servers: McpServer[], ref: string): McpServer | undefined {
  return servers.find(server => server.enabled && (server.id === ref || server.name === ref));
}

async function describeServer(server: McpServer): Promise<string> {
  try {
    const tools = await listMcpTools(server);
    if (tools.length === 0) return `- ${server.name} [id: ${server.id}]: no tools`;
    const lines = tools.map(tool => {
      const description = clipText(tool.description ?? '', MCP_DESCRIPTION_MAX_CHARS);
      const schema = tool.inputSchema === undefined ? '' : ` schema: ${JSON.stringify(tool.inputSchema)}`;
      return `  - ${tool.name}: ${description}${schema}`;
    });
    return [`- ${server.name} [id: ${server.id}]`, ...lines].join('\n');
  } catch (error) {
    return `- ${server.name} [id: ${server.id}]: unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
}

export function createListMcpToolsAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof listMcpToolsActionSchema.schema>) => {
    const intent = input.intent || t('act_listMcpTools_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const enabled = (await mcpServersStore.getAll()).filter(server => server.enabled);
    if (enabled.length === 0) {
      const msg = t('act_listMcpTools_none');
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }
    const msg = t('act_listMcpTools_ok', [enabled.length.toString()]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
    const sections = await Promise.all(enabled.map(describeServer));
    return new ActionResult({ extractedContent: `${msg}\n${sections.join('\n')}`, includeInMemory: true });
  }, listMcpToolsActionSchema);
}

export function createCallMcpToolAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof callMcpToolActionSchema.schema>) => {
    const intent = input.intent || t('act_callMcpTool_start', [input.tool, input.server]);
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

    const server = findEnabledServer(await mcpServersStore.getAll(), input.server);
    if (!server) {
      const msg = t('act_callMcpTool_notFound', [input.server]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    }

    try {
      const result = await callMcpTool(server, input.tool, input.args);
      if (result.isError) {
        const msg = t('act_callMcpTool_fail', [input.tool]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({
          error: `${msg}\n${clipText(result.text, MCP_RESULT_MAX_CHARS)}`,
          includeInMemory: true,
        });
      }
      const msg = t('act_callMcpTool_ok', [input.tool]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      // Tool output comes from a remote server, so it is untrusted content.
      return new ActionResult({
        extractedContent: `${msg}\n${wrapUntrustedContent(clipText(result.text, MCP_RESULT_MAX_CHARS))}`,
        includeInMemory: true,
      });
    } catch (error) {
      if (!(error instanceof McpClientError)) throw error;
      const msg = t('act_callMcpTool_fail', [input.tool]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: `${msg}: ${error.message}`, includeInMemory: true });
    }
  }, callMcpToolActionSchema);
}
