// Claude Code (`claude -p --output-format stream-json`). The task goes in on stdin; the browser comes from the
// `qagent` MCP server that the generated --mcp-config starts.
import { clipDetails, parseJsonLine, type CliEvent, type StreamParser } from './types';

export const CLAUDE_MCP_SERVER_NAME = 'qagent';
const MCP_TOOL_PREFIX = `mcp__${CLAUDE_MCP_SERVER_NAME}__`;
const SERVER_STARTING = ['connected', 'pending'];

export function claudeArgs(options: { mcpConfigPath: string; systemPrompt: string; model?: string }): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--mcp-config',
    options.mcpConfigPath,
    '--strict-mcp-config',
    // The user runs this on their own machine with their own task; no approval prompts stop a headless run.
    '--permission-mode',
    'bypassPermissions',
    '--append-system-prompt',
    options.systemPrompt,
    ...(options.model ? ['--model', options.model] : []),
  ];
}

/** The MCP config that starts `qagent mcp` (this package's bin) for the CLI. */
export function claudeMcpConfig(nodePath: string, binPath: string): Record<string, unknown> {
  return { mcpServers: { [CLAUDE_MCP_SERVER_NAME]: { command: nodePath, args: [binPath, 'mcp'] } } };
}

function describeTool(name: string, input: unknown): string {
  const short = name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
  return clipDetails(`${short} ${input === undefined ? '' : JSON.stringify(input)}`.trim());
}

interface ContentBlock {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  text?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
}

function blocksOf(message: unknown): ContentBlock[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

export function createClaudeParser(): StreamParser {
  const toolNames = new Map<string, string>();
  let lastText = '';
  let finished = false;

  const done = (ok: boolean, text: string, error?: string): CliEvent[] => {
    finished = true;
    return [{ type: 'done', ok, text, ...(error ? { error } : {}) }];
  };

  return {
    consume(line) {
      const message = parseJsonLine(line);
      if (!message || finished) return [];
      switch (message.type) {
        case 'system': {
          if (message.subtype !== 'init') return [];
          const servers = Array.isArray(message.mcp_servers)
            ? (message.mcp_servers as { name?: unknown; status?: unknown }[])
            : [];
          const browser = servers.find(server => server.name === CLAUDE_MCP_SERVER_NAME);
          if (!browser || typeof browser.status !== 'string' || !SERVER_STARTING.includes(browser.status)) {
            // Without the server the model would answer without the page, so the run fails instead.
            return done(
              false,
              '',
              `The ${CLAUDE_MCP_SERVER_NAME} browser tools did not start (${browser?.status ?? 'missing'})`,
            );
          }
          return [];
        }
        case 'assistant': {
          const events: CliEvent[] = [];
          for (const block of blocksOf(message.message)) {
            if (block.type === 'text' && typeof block.text === 'string') lastText = block.text;
            if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
              toolNames.set(block.id, block.name);
              events.push({ type: 'step', state: 'act.start', details: describeTool(block.name, block.input) });
            }
          }
          return events;
        }
        case 'user': {
          const events: CliEvent[] = [];
          for (const block of blocksOf(message.message)) {
            if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
            const name = toolNames.get(block.tool_use_id) ?? 'tool';
            toolNames.delete(block.tool_use_id);
            events.push({
              type: 'step',
              state: block.is_error === true ? 'act.fail' : 'act.ok',
              details: describeTool(name, undefined),
            });
          }
          return events;
        }
        case 'result': {
          if (message.is_error === true || message.subtype !== 'success') {
            const reason =
              typeof message.result === 'string' && message.result ? message.result : String(message.subtype);
            return done(false, '', reason);
          }
          const text = typeof message.result === 'string' ? message.result : lastText;
          return done(true, text);
        }
        default:
          return [];
      }
    },
    finish() {
      return finished ? [] : done(false, '', 'Claude Code exited without a result');
    },
  };
}
