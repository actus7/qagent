// The daemon: the WebSocket server the extension dials, the local control channel, host tools and CLI agents.
import { join } from 'node:path';
import { QAgentMcpBridge, type ExtensionHandler } from './bridge';
import { CliTaskRunner, isRunner, isValidTaskId, resolveCliCommand, type CliRunnerOptions } from './cli/runner';
import { ControlServer } from './control';
import { runHostTool } from './host';
import {
  BridgeError,
  CLI_RUNNERS,
  type CliRunner,
  type McpBridgeEventFrame,
  type McpBridgeHostMethod,
} from './protocol';
import { stateDirFrom } from './config';

const CLI_TASK_MAX_CHARS = 8000;

export interface DaemonOptions {
  token: string;
  host?: string;
  port?: number;
  controlPort?: number;
  stateDir?: string;
  binPath?: string;
  cliTimeoutMs?: number;
  resolveCli?: CliRunnerOptions['resolve'];
  version?: string;
}

function readCliTaskParams(params: Record<string, unknown>): {
  taskId: string;
  runner: CliRunner;
  task: string;
  tabId?: number;
} {
  const { taskId, runner, task, tabId } = params;
  if (!isValidTaskId(taskId)) {
    throw new BridgeError('INVALID_PARAMS', 'taskId must be 1 to 128 letters, digits, "_" or "-"');
  }
  if (!isRunner(runner)) throw new BridgeError('INVALID_PARAMS', `runner must be one of: ${CLI_RUNNERS.join(', ')}`);
  if (typeof task !== 'string' || task.trim().length === 0 || task.length > CLI_TASK_MAX_CHARS) {
    throw new BridgeError('INVALID_PARAMS', `task must have 1 to ${CLI_TASK_MAX_CHARS} characters`);
  }
  if (tabId !== undefined && (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 1)) {
    throw new BridgeError('INVALID_PARAMS', 'tabId must be a positive integer');
  }
  return { taskId, runner, task, ...(tabId === undefined ? {} : { tabId }) };
}

/** Answers the extension's host requests: host tools directly, CLI agent runs through the runner. */
export function createExtensionHandler(cli: CliTaskRunner): ExtensionHandler {
  return {
    async handle(method: McpBridgeHostMethod, params, sendEvent) {
      if (method === 'run_cli_task') {
        const input = readCliTaskParams(params);
        return cli.run(input, (taskId, state, details) => {
          const event: McpBridgeEventFrame = { type: 'event', taskId, state, details };
          sendEvent(event);
        });
      }
      if (method === 'cancel_cli_task') {
        const taskId = typeof params.taskId === 'string' ? params.taskId : '';
        return { cancelled: cli.cancel(taskId) };
      }
      return runHostTool(method, params);
    },
  };
}

/** The daemon owns the WebSocket bridge for the extension and the control channel for local clients. */
export class QAgentDaemon {
  readonly bridge: QAgentMcpBridge;
  readonly control: ControlServer;
  readonly cli: CliTaskRunner;
  private readonly startedAt = Date.now();
  private stopResolver: (() => void) | null = null;

  constructor(private readonly options: DaemonOptions) {
    const stateDir = options.stateDir ?? stateDirFrom();
    const binPath = options.binPath ?? join(__dirname, 'bin.js');
    const resolve = options.resolveCli ?? ((runner: CliRunner) => resolveCliCommand(runner));
    this.cli = new CliTaskRunner({ stateDir, binPath, timeoutMs: options.cliTimeoutMs, resolve });
    this.bridge = new QAgentMcpBridge({
      token: options.token,
      host: options.host,
      port: options.port,
      handler: createExtensionHandler(this.cli),
    });
    this.control = new ControlServer({
      token: options.token,
      port: options.controlPort,
      target: {
        request: (method, params) => this.bridge.request(method, params),
        host: (method, params) => runHostTool(method, params),
        isExtensionConnected: () => this.bridge.isExtensionConnected(),
      },
      describe: () => this.describe(),
      onShutdown: () => this.stopResolver?.(),
    });
  }

  async start(): Promise<void> {
    await this.bridge.start();
    await this.control.start();
  }

  async stop(): Promise<void> {
    await this.control.stop();
    await this.bridge.stop();
  }

  /** Resolves when `POST /v1/shutdown` arrives. */
  untilShutdown(): Promise<void> {
    return new Promise(resolve => {
      this.stopResolver = resolve;
    });
  }

  describe(): Record<string, unknown> {
    const cli = Object.fromEntries(
      CLI_RUNNERS.map(runner => [runner, (this.options.resolveCli ?? (r => resolveCliCommand(r)))(runner) !== null]),
    );
    return {
      pid: process.pid,
      version: this.options.version ?? 'unknown',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      bridgeAddress: this.bridge.getAddress(),
      controlPort: this.control.getPort(),
      cliAgentsOnPath: cli,
    };
  }
}
