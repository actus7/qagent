import { describe, it, expect } from 'vitest';
import { ActionBuilder } from '../builder';
import type { AgentContext } from '../../types';

// Snapshot of action names, in order, as returned by buildDefaultActions().
// Order may matter for prompts; any change here must be deliberate.
const DEFAULT_ACTION_NAMES = [
  'done',
  'search_google',
  'open',
  'go_to_url',
  'back',
  'go_back',
  'forward',
  'reload',
  'wait',
  'click',
  'click_element',
  'fill',
  'type',
  'input_text',
  'press',
  'scroll',
  'scrollintoview',
  'get_text',
  'get_title',
  'get_url',
  'snapshot',
  'switch_tab',
  'open_tab',
  'close_tab',
  'cache_content',
  'scroll_to_percent',
  'scroll_to_top',
  'scroll_to_bottom',
  'previous_page',
  'next_page',
  'scroll_to_text',
  'send_keys',
  'get_dropdown_options',
  'select_dropdown_option',
  'upload_file',
  'read_console_messages',
  'read_network_requests',
  'execute_javascript',
  'click_at',
  'hover',
  'drag',
  'resize_viewport',
  'request_user_takeover',
  'list_plugins',
  'call_plugin_tool',
  'save_plugin',
];

const AGENT_BROWSER_V1_ACTION_NAMES = [
  'done',
  'search_google',
  'open',
  'go_to_url',
  'back',
  'go_back',
  'forward',
  'reload',
  'wait',
  'click',
  'click_element',
  'fill',
  'type',
  'input_text',
  'press',
  'get_text',
  'get_title',
  'get_url',
  'snapshot',
  'cache_content',
  'send_keys',
];

function buildNames(engineName: string): string[] {
  // Only getEngineName is touched while building; action handlers are not invoked.
  const context = {
    browserContext: { getEngineName: () => engineName },
  } as unknown as AgentContext;
  const builder = new ActionBuilder(context);
  return builder.buildDefaultActions().map(action => action.name());
}

describe('ActionBuilder.buildDefaultActions order guard', () => {
  it('returns the default action names, and the agent-browser-v1 subset, in a fixed order', () => {
    expect(buildNames('default')).toEqual(DEFAULT_ACTION_NAMES);
    expect(buildNames('agent-browser-v1')).toEqual(AGENT_BROWSER_V1_ACTION_NAMES);
  });
});
