import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HumanMessage } from '@langchain/core/messages';
import { ProviderTypeEnum } from '@extension/storage';
import { convertZodToJsonSchema } from '@src/background/utils';
import { plannerOutputSchema } from '../agents/planner';

// End-to-end check of the LangChain structured-output path the agents use (withStructuredOutput + includeRaw),
// against a local OpenAI-compatible server. Guards LangChain/zod upgrades without a real API key.
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

async function model() {
  const { createChatModel } = await import('../helper');
  return createChatModel(
    { type: ProviderTypeEnum.OpenAI, apiKey: 'sk-test', baseUrl },
    { provider: ProviderTypeEnum.OpenAI, modelName: 'gpt-4o' },
  );
}

describe('structured output round trip', { timeout: 30_000 }, () => {
  it('parses a JSON-schema response like the navigator does', async () => {
    const schema = z.object({
      current_state: z.object({ evaluation_previous_goal: z.string(), memory: z.string(), next_goal: z.string() }),
      action: z.array(
        z.object({ click: z.object({ intent: z.string(), selector: z.string() }).nullable().optional() }),
      ),
    });
    const jsonSchema = convertZodToJsonSchema(schema, 'NavigatorAgentOutput', true);

    const llm = (await model()).withStructuredOutput(jsonSchema, { includeRaw: true, name: 'NavigatorAgentOutput' });
    const response = await llm.invoke([new HumanMessage('next step?')]);

    expect(response.parsed).toEqual(answer);
    expect(JSON.stringify(requests.at(-1))).toContain('NavigatorAgentOutput');
  });

  it('parses a zod-schema response like the base agent does', async () => {
    const schema = z.object({ evaluation_previous_goal: z.string(), memory: z.string(), next_goal: z.string() });
    const wrapper = z.object({ current_state: schema, action: z.array(z.record(z.string(), z.unknown())) });

    const llm = (await model()).withStructuredOutput(wrapper, { includeRaw: true, name: 'planner_output' });
    const response = await llm.invoke([new HumanMessage('plan?')]);

    expect(response.parsed).toEqual(answer);
  });

  it('sends the planner schema (union with a transform) as input JSON schema', async () => {
    // BaseAgent.invoke converts on our side: LangChain 1.x would throw on the transform.
    const jsonSchema = convertZodToJsonSchema(plannerOutputSchema, 'planner_output');
    const llm = (await model()).withStructuredOutput(jsonSchema, { includeRaw: true, name: 'planner_output' });
    await expect(llm.invoke([new HumanMessage('plan?')])).resolves.toHaveProperty('raw');
    expect(JSON.stringify(requests.at(-1))).toContain('next_steps');
    expect(plannerOutputSchema.shape.done.parse('true')).toBe(true);
  });
});
