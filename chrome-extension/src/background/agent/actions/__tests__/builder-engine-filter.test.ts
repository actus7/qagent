import { describe, expect, it } from 'vitest';
import { ActionBuilder } from '../builder';
import type { AgentContext } from '../../types';
import type { BrowserEngineName } from '../../../browser/types';

function buildNames(engine: BrowserEngineName): string[] {
  const context = {
    browserContext: { getEngineName: () => engine },
  } as unknown as AgentContext;
  return new ActionBuilder(context).buildDefaultActions().map(action => action.name());
}

describe('ActionBuilder engine filter', () => {
  it('keeps every action on the chrome-debugger engine', () => {
    const names = buildNames('chrome-debugger');
    expect(names).toContain('click_at');
    expect(names).toContain('screenshot');
    expect(names).toContain('find_captcha');
  });

  it('drops the CDP-only actions on the content-script engine', () => {
    const names = buildNames('content-script');
    for (const name of ['click_at', 'hover', 'drag', 'screenshot', 'read_console_messages', 'find_captcha']) {
      expect(names).not.toContain(name);
    }
  });

  it('keeps the core interaction actions on the content-script engine', () => {
    const names = buildNames('content-script');
    for (const name of ['click', 'fill', 'type', 'press', 'scroll', 'switch_tab', 'execute_javascript', 'done']) {
      expect(names).toContain(name);
    }
  });
});
