import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProviderTypeEnum } from '@extension/storage';
import { BaseAgent } from '../agents/base';
import { BasePrompt } from '../prompts/base';
import type { AgentContext, AgentOutput } from '../types';
import { systemMessage, userMessage } from '../messages/model-messages';

// End-to-end check of the AI SDK structured-output path the agents use (one forced tool call), against a local
// OpenAI-compatible server. Guards AI SDK/zod upgrades without a real API key.
const answer = {
  current_state: { evaluation_previous_goal: 'ok', memory: 'm', next_goal: 'g' },
  action: [{ click: { intent: 'open menu', selector: '@e3' } }],
};

const requests: Array<Record<string, unknown>> = [];
let server: Server;
let baseUrl: string;

function completion(body: Record<string, unknown>) {
  const tools = body.tools as Array<{ function: { name: string } }> | undefined;
  const message = tools?.length
    ? {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: tools[0].function.name, arguments: JSON.stringify(answer) },
          },
        ],
      }
    : { role: 'assistant', content: JSON.stringify(answer) };
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 0,
    model: body.model,
    choices: [{ index: 0, message, finish_reason: tools?.length ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(completion(body)));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const schema = z.object({
  current_state: z.object({ evaluation_previous_goal: z.string(), memory: z.string(), next_goal: z.string() }),
  action: z.array(z.record(z.string(), z.unknown())),
});

class TestPrompt extends BasePrompt {
  getSystemMessage() {
    return systemMessage('system');
  }
  async getUserMessage() {
    return userMessage('user');
  }
}

class TestAgent extends BaseAgent<typeof schema, never> {
  async execute(): Promise<AgentOutput<never>> {
    return { id: this.id };
  }
}

async function agentFor(provider: ProviderTypeEnum, modelName: string) {
  const { createChatModel } = await import('../helper');
  const chatLLM = createChatModel({ type: provider, apiKey: 'sk-test', baseUrl }, { provider, modelName });
  return new TestAgent(schema, {
    chatLLM,
    context: { controller: new AbortController() } as AgentContext,
    prompt: new TestPrompt(),
  });
}

describe('structured output round trip', { timeout: 30_000 }, () => {
  it('reads the agent output from the forced tool call (OpenAI provider)', async () => {
    const agent = await agentFor(ProviderTypeEnum.OpenAI, 'gpt-4o');
    const output = await agent.invoke([userMessage('next step?')]);

    expect(output).toEqual(answer);
    const sent = requests.at(-1) as { tools: Array<{ function: { name: string } }>; tool_choice: unknown };
    expect(sent.tools).toHaveLength(1);
    expect(sent.tools[0].function.name).toBe('agent_output');
    expect(sent.tool_choice).toEqual({ type: 'function', function: { name: 'agent_output' } });
  });

  it('uses tool calling, never response_format, so strict OpenAI-compatible routers accept it', async () => {
    const agent = await agentFor(ProviderTypeEnum.CustomOpenAI, 'mimo-v2.6-pro');
    const output = await agent.invoke([userMessage('next step?')]);

    expect(output).toEqual(answer);
    const sent = requests.at(-1) as Record<string, unknown>;
    expect(sent.response_format).toBeUndefined();
    expect(sent.tools).toHaveLength(1);
    expect(sent.model).toBe('mimo-v2.6-pro');
  });

  it('falls back to parsing JSON from the text for models without tool calling', async () => {
    // Llama API models are answered without tools (manual JSON extraction)
    const agent = await agentFor(ProviderTypeEnum.CustomOpenAI, 'Llama-4-Maverick');
    const output = await agent.invoke([userMessage('next step?')]);

    expect(output).toEqual(answer);
    expect((requests.at(-1) as Record<string, unknown>).tools).toBeUndefined();
  });
});
