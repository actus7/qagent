import { mcpServersStore, type McpServer } from '@extension/storage';
import { listMcpTools } from '@extension/shared';
import type { AgentContext } from '../agent/types';
import { clipText } from '../agent/actions/shared';
import { createLogger } from '../log';

const logger = createLogger('Mcp');

const MCP_PROMPT_MAX_SERVERS = 5;
const MCP_PROMPT_MAX_TOOLS = 20;
const MCP_PROMPT_MAX_CHARS = 1500;

/** Tool names of one server, fetched once per task. A server that cannot be reached is remembered as null. */
async function toolNamesFor(context: AgentContext, server: McpServer): Promise<string[] | null> {
  if (context.mcpToolNames.has(server.id)) return context.mcpToolNames.get(server.id) ?? null;
  let names: string[] | null;
  try {
    names = (await listMcpTools(server)).map(tool => tool.name);
  } catch (error) {
    logger.warning(`MCP server ${server.name} is unavailable for this task`, error);
    names = null;
  }
  context.mcpToolNames.set(server.id, names);
  return names;
}

/** Compact section for the state message: the enabled MCP servers and their tool names, capped. */
export async function loadMcpPromptSection(context: AgentContext): Promise<string> {
  let servers: McpServer[];
  try {
    servers = (await mcpServersStore.getAll()).filter(server => server.enabled).slice(0, MCP_PROMPT_MAX_SERVERS);
  } catch (error) {
    logger.error('Could not load MCP servers for the prompt', error);
    return '';
  }
  if (servers.length === 0) return '';

  const lines = await Promise.all(
    servers.map(async server => {
      const names = await toolNamesFor(context, server);
      if (names === null) return `- ${server.name} [id: ${server.id}]: unavailable`;
      const shown = names.slice(0, MCP_PROMPT_MAX_TOOLS).join(', ') || 'no tools';
      const hidden = names.length > MCP_PROMPT_MAX_TOOLS ? ` (+${names.length - MCP_PROMPT_MAX_TOOLS} more)` : '';
      return `- ${server.name} [id: ${server.id}]: ${shown}${hidden}`;
    }),
  );
  const text = [
    'MCP servers (call_mcp_tool {server, tool, args}; list_mcp_tools shows the input schemas):',
    ...lines,
  ].join('\n');
  return `${clipText(text, MCP_PROMPT_MAX_CHARS)}\n`;
}
