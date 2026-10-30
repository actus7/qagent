import type { McpBridgeCliRunner } from '@extension/shared';

// Who is driving the browser. The page overlay shows it as a colour (see pages/content/src/overlay.css).
export type OverlayDriver = 'qagent' | 'claude' | 'codex' | 'external';

export const DEFAULT_OVERLAY_DRIVER: OverlayDriver = 'qagent';

const CLI_DRIVERS: Record<McpBridgeCliRunner, OverlayDriver> = { claude: 'claude', codex: 'codex' };

/** The driver of a CLI agent task: the CLI chosen in options. */
export function driverForCliRunner(runner: McpBridgeCliRunner): OverlayDriver {
  return CLI_DRIVERS[runner];
}

/**
 * Maps the MCP client name from `initialize` (clientInfo.name, e.g. "claude-code" or "codex-mcp-client") to a
 * driver. Any name not recognised is the neutral 'external' driver.
 */
export function driverForMcpClient(clientName: string | undefined): OverlayDriver {
  const name = clientName?.toLowerCase() ?? '';
  if (name.includes('claude')) return 'claude';
  if (name.includes('codex')) return 'codex';
  return 'external';
}
