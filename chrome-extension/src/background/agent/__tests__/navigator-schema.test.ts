import { describe, it, expect } from 'vitest';
import { ActionBuilder } from '../actions/builder';
import { NavigatorActionRegistry } from '../agents/navigator';
import { convertZodToJsonSchema } from '@src/background/utils';
import type { AgentContext } from '../types';

// The navigator's JSON schema and the action prompts are sent to the LLM verbatim.
// These snapshots make any change to them (e.g. a zod or converter upgrade) show up as a reviewable diff.
function buildActions() {
  const context = { browserContext: { getEngineName: () => 'puppeteer' } } as unknown as AgentContext;
  return new ActionBuilder(context).buildDefaultActions();
}

describe('navigator model contract', () => {
  it('keeps the structured-output JSON schema stable', () => {
    const registry = new NavigatorActionRegistry(buildActions());
    const schema = convertZodToJsonSchema(registry.setupModelOutputSchema(), 'NavigatorAgentOutput', true);
    expect(schema).toMatchSnapshot();
  });

  it('keeps the action prompts stable', () => {
    expect(buildActions().map(action => action.prompt())).toMatchSnapshot();
  });
});
