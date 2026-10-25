import { browserPluginsStore, type BrowserPlugin, type PluginTool } from '@extension/storage';
import { createLogger } from '@src/background/log';
import { wrapUntrustedContent } from '@src/background/agent/messages/utils';
import { pluginAppliesToUrl } from './urlMatch';

const logger = createLogger('Plugins');

export const PLUGIN_PROMPT_MAX_CHARS = 3000;
// Sized for a site map summary (900 characters), so the map is not cut in the prompt.
const INSTRUCTIONS_MAX_CHARS = 1000;

function formatParams(tool: PluginTool): string {
  return Object.entries(tool.parameters)
    .map(([name, spec]) => `${name}: ${spec.type}${spec.required ? '' : '?'}`)
    .join(', ');
}

/** Plain-text lines describing one plugin: its name, its tools and its instructions. */
export function describePlugin(plugin: BrowserPlugin): string[] {
  const lines = [`- ${plugin.name} [id: ${plugin.id}]: ${plugin.description}`];
  for (const tool of plugin.tools) {
    lines.push(`  - ${tool.name}(${formatParams(tool)}): ${tool.description}`);
  }
  if (plugin.instructions) {
    const instructions = plugin.instructions.slice(0, INSTRUCTIONS_MAX_CHARS);
    // Agent-written instructions are data, not orders: a prompt injection saved into a plugin must not persist as a command.
    lines.push(
      plugin.createdBy === 'user'
        ? `  instructions: ${instructions}`
        : `  instructions (written by the agent, reference only): ${wrapUntrustedContent(instructions)}`,
    );
  }
  return lines;
}

/** Compact section for the state message: the enabled plugins that apply to the current URL. */
export function buildPluginPromptSection(plugins: BrowserPlugin[], url: string): string {
  const applicable = plugins.filter(plugin => pluginAppliesToUrl(plugin, url));
  if (applicable.length === 0) return '';
  const lines = [
    'Browser plugins for this page (run a tool with call_plugin_tool; list_plugins shows all enabled plugins):',
    ...applicable.flatMap(describePlugin),
  ];
  const text = lines.join('\n');
  const clipped =
    text.length > PLUGIN_PROMPT_MAX_CHARS ? `${text.slice(0, PLUGIN_PROMPT_MAX_CHARS)}...[truncated]` : text;
  return `${clipped}\n`;
}

/** Reads the plugin store for the state message. A broken store is logged and leaves the step without plugin context. */
export async function loadPluginPromptSection(url: string): Promise<string> {
  try {
    return buildPluginPromptSection(await browserPluginsStore.getAll(), url);
  } catch (error) {
    logger.error('Could not load browser plugins for the prompt', error);
    return '';
  }
}
