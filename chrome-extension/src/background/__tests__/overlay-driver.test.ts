import { describe, expect, it } from 'vitest';
import { driverForCliRunner, driverForMcpClient } from '../overlay/overlayDriver';

describe('driverForMcpClient', () => {
  it('maps Claude clients to the claude driver whatever their exact name', () => {
    expect(driverForMcpClient('claude-code')).toBe('claude');
    expect(driverForMcpClient('Claude Desktop')).toBe('claude');
  });

  it('maps Codex clients to the codex driver', () => {
    expect(driverForMcpClient('codex-mcp-client')).toBe('codex');
    expect(driverForMcpClient('Codex')).toBe('codex');
  });

  it('falls back to the neutral external driver for unknown or missing names', () => {
    expect(driverForMcpClient('cursor')).toBe('external');
    expect(driverForMcpClient('')).toBe('external');
    expect(driverForMcpClient(undefined)).toBe('external');
  });
});

describe('driverForCliRunner', () => {
  it('colours a CLI task by the CLI that runs it', () => {
    expect(driverForCliRunner('claude')).toBe('claude');
    expect(driverForCliRunner('codex')).toBe('codex');
  });
});
