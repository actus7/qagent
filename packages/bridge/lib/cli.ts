// The `qagent` command line: start, mcp, pair, status, stop.
import { ensureToken, configFilePath, readToken, rotateToken } from './config';
import { ControlClient } from './control';
import { QAgentDaemon } from './daemon';
import { runMcpServer } from './mcp-server';
import { CONTROL_DEFAULT_PORT, MCP_BRIDGE_DEFAULT_PORT } from './protocol';

const PACKAGE_VERSION = '0.1.0';

const USAGE = `qagent ${PACKAGE_VERSION} - local bridge between QAgent (Chrome extension) and MCP clients and CLI agents

Commands:
  qagent start [--port N] [--control-port N]   run the daemon in the foreground (Ctrl+C stops it)
  qagent mcp                                   MCP server over stdio for Claude Code, Codex, ...
  qagent pair [--rotate]                       show the shared token (or create / rotate it) and the setup steps
  qagent status                                report the running daemon
  qagent stop                                  stop the running daemon

Environment: QAGENT_HOME (state directory, default ~/.qagent), QAGENT_MCP_TOKEN (token override),
QAGENT_MCP_PORT (extension port, default ${MCP_BRIDGE_DEFAULT_PORT}), QAGENT_CONTROL_PORT (default ${CONTROL_DEFAULT_PORT}),
QAGENT_CLAUDE_BIN / QAGENT_CODEX_BIN (CLI executables when they are not on PATH).`;

interface Flags {
  positional: string[];
  values: Map<string, string>;
  switches: Set<string>;
}

/** Splits `--name value` and `--switch` from positional words. Unknown flags are kept, not rejected. */
export function parseFlags(args: string[]): Flags {
  const flags: Flags = { positional: [], values: new Map(), switches: new Set() };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      flags.positional.push(arg);
      continue;
    }
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.values.set(arg.slice(2), next);
      index += 1;
    } else {
      flags.switches.add(arg.slice(2));
    }
  }
  return flags;
}

function portFrom(flags: Flags, name: string, fallback: number): number {
  const raw = flags.values.get(name);
  if (raw === undefined) return fallback;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(`--${name} must be a port from 1024 to 65535`);
  return port;
}

function controlPortFromEnv(env: NodeJS.ProcessEnv): number {
  const port = Number.parseInt(env.QAGENT_CONTROL_PORT ?? String(CONTROL_DEFAULT_PORT), 10);
  return Number.isInteger(port) ? port : CONTROL_DEFAULT_PORT;
}

async function start(flags: Flags, env: NodeJS.ProcessEnv, out: (line: string) => void): Promise<number> {
  const { token, created } = ensureToken(env);
  const daemon = new QAgentDaemon({
    token,
    port: portFrom(flags, 'port', Number.parseInt(env.QAGENT_MCP_PORT ?? String(MCP_BRIDGE_DEFAULT_PORT), 10)),
    controlPort: portFrom(flags, 'control-port', controlPortFromEnv(env)),
    version: PACKAGE_VERSION,
  });
  await daemon.start();
  out(`QAgent daemon ${PACKAGE_VERSION} started (pid ${process.pid}).`);
  out(`  extension bridge: ${daemon.bridge.getAddress()} (the extension connects here)`);
  out(`  control channel:  127.0.0.1:${daemon.control.getPort()} (MCP clients and qagent status)`);
  if (created) out(`  token created in ${configFilePath(env)}; run "qagent pair" to see it.`);
  out('Press Ctrl+C or run "qagent stop" to stop.');
  const stop = () => daemon.stop();
  process.once('SIGINT', () => void stop().then(() => process.exit(0)));
  process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
  await daemon.untilShutdown();
  await stop();
  out('QAgent daemon stopped.');
  return 0;
}

function pair(flags: Flags, env: NodeJS.ProcessEnv, out: (line: string) => void): number {
  const token = flags.switches.has('rotate') ? rotateToken(env) : ensureToken(env).token;
  out(`Shared token: ${token}`);
  out('');
  out('Setup:');
  out('  1. Load the QAgent extension (chrome://extensions, Developer mode, Load unpacked: dist/).');
  out('  2. Open the extension options, section "MCP bridge": enable it and paste the token above.');
  out('  3. Start the daemon: qagent start');
  out('  4. Register the MCP server in your CLI:');
  out('       Claude Code: claude mcp add qagent -- qagent mcp');
  out('       Codex:       codex mcp add qagent -- qagent mcp');
  if (flags.switches.has('rotate')) {
    out('');
    out('The token was rotated. Update the extension settings and restart the daemon.');
  }
  return 0;
}

async function status(env: NodeJS.ProcessEnv, out: (line: string) => void): Promise<number> {
  const token = readToken(env);
  if (!token) {
    out('No token configured. Run "qagent pair".');
    return 1;
  }
  try {
    const report = await new ControlClient(controlPortFromEnv(env), token).status();
    out(JSON.stringify(report, null, 2));
    return 0;
  } catch {
    out('QAgent daemon is not running. Start it with: qagent start');
    return 1;
  }
}

async function stop(env: NodeJS.ProcessEnv, out: (line: string) => void): Promise<number> {
  const token = readToken(env);
  if (!token) {
    out('No token configured; no daemon to stop.');
    return 1;
  }
  try {
    await new ControlClient(controlPortFromEnv(env), token).shutdown();
    out('Stop requested.');
    return 0;
  } catch {
    out('QAgent daemon is not running.');
    return 1;
  }
}

/** Runs one command and returns the process exit code. */
export async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  out = (line: string) => console.log(line),
): Promise<number> {
  const [command = 'help', ...rest] = args;
  const flags = parseFlags(rest);
  try {
    switch (command) {
      case 'start':
        return await start(flags, env, out);
      case 'mcp':
        await runMcpServer(env);
        return 0;
      case 'pair':
        return pair(flags, env, out);
      case 'status':
        return await status(env, out);
      case 'stop':
        return await stop(env, out);
      case 'help':
      case '--help':
      case '-h':
        out(USAGE);
        return 0;
      default:
        out(`Unknown command: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    out(`qagent: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
