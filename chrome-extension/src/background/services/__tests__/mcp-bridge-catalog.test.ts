import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({ default: {} }));
vi.mock('../../state/browserSession', () => ({
  browserContext: { getEngineName: () => 'chrome-debugger' },
}));
vi.mock('../../task/taskRunner', () => ({ isAssistantTaskRunning: () => false }));

const { listBridgeActions } = await import('../mcpBridge/actionRunner');

describe('list_actions catalog', () => {
  const { actions } = listBridgeActions();
  const names = actions.map(action => action.name);

  it('exposes browser actions with a JSON schema for each input', () => {
    expect(names).toContain('click');
    expect(names).toContain('page_info');
    for (const action of actions) {
      expect(action.description.length).toBeGreaterThan(0);
      expect(action.inputSchema.type).toBe('object');
    }
  });

  it('leaves out task control and host tools', () => {
    for (const hidden of ['done', 'ask_user', 'todo_write', 'shell_exec', 'fs_write']) {
      expect(names).not.toContain(hidden);
    }
  });
});
