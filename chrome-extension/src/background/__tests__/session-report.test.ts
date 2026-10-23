import { describe, expect, it } from 'vitest';
import {
  buildSessionReportHtml,
  buildSessionReportMarkdown,
  escapeHtml,
  parseAgentStepHistory,
  type ReportLabels,
  type SessionReportInput,
} from '@extension/shared';

const labels: ReportLabels = {
  title: 'Report',
  generatedAt: 'Generated',
  models: 'Models',
  noModels: 'none',
  messages: 'Conversation',
  finalAnswer: 'Final answer',
  noFinalAnswer: 'No final answer',
  steps: 'Steps',
  noSteps: 'No steps',
  step: 'Step',
  intent: 'intent',
  result: 'Result',
  error: 'Error',
  compacted: 'Compacted',
  you: 'You',
  assistant: 'Assistant',
  system: 'System',
};

const hostile = '<script>alert("x")</script><img src=x onerror=alert(1)>';

const input = (overrides: Partial<SessionReportInput> = {}): SessionReportInput => ({
  title: 'Session',
  generatedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
  models: ['openai/gpt-4o'],
  messages: [
    { actor: 'user', content: 'click Go', timestamp: 1 },
    { actor: 'assistant', content: 'Clicked', timestamp: 2, kind: 'answer' },
  ],
  steps: [],
  labels,
  ...overrides,
});

describe('escapeHtml', () => {
  it('escapes the characters that can open markup or end an attribute', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('buildSessionReportHtml', () => {
  it('escapes page-derived and user-derived text so no script or tag survives', () => {
    // Arrange: hostile text in the chat, the step result, the page title and the session title
    const report = buildSessionReportHtml(
      input({
        title: hostile,
        messages: [{ actor: 'assistant', content: hostile, timestamp: 1, kind: 'answer' }],
        steps: [
          {
            index: 1,
            url: `https://example.com/?q=${hostile}`,
            title: hostile,
            actions: [{ name: 'click_element', intent: hostile, result: hostile, error: hostile }],
          },
        ],
      }),
    );

    // Assert
    expect(report).not.toContain('<script');
    expect(report).not.toContain('<img');
    expect(report).not.toContain('onerror=alert(1)>');
    expect(report).toContain('&lt;script&gt;');
  });

  it('is a complete document with no script element', () => {
    const report = buildSessionReportHtml(input());

    expect(report.startsWith('<!doctype html>')).toBe(true);
    expect(report).not.toMatch(/<script[\s>]/i);
    expect(report).toContain('click Go');
  });

  it('shows the last recorded answer as the final answer', () => {
    const report = buildSessionReportHtml(
      input({
        messages: [
          { actor: 'assistant', content: 'first answer', timestamp: 1, kind: 'answer' },
          { actor: 'assistant', content: 'last answer', timestamp: 2, kind: 'answer' },
        ],
      }),
    );

    expect(report).toContain('last answer');
    expect(report).not.toContain('No final answer');
  });

  it('marks compaction as a divider instead of showing the summary as a bubble', () => {
    const report = buildSessionReportHtml(
      input({ messages: [{ actor: 'system', content: 'summary text', timestamp: 1, kind: 'compaction' }] }),
    );

    expect(report).toContain('Compacted');
    expect(report).not.toContain('summary text');
  });
});

describe('buildSessionReportMarkdown', () => {
  it('puts message text in a fence longer than any backtick run it contains', () => {
    const markdown = buildSessionReportMarkdown(
      input({ messages: [{ actor: 'user', content: 'code ```js\nx\n``` end', timestamp: 1 }] }),
    );

    expect(markdown).toContain('````text\ncode ```js\nx\n``` end\n````');
  });

  it('lists steps with their actions, results and errors', () => {
    const markdown = buildSessionReportMarkdown(
      input({
        steps: [
          {
            index: 1,
            url: 'https://example.com',
            title: 'Example',
            actions: [{ name: 'click_element', intent: 'open menu', result: 'opened', error: null }],
          },
        ],
      }),
    );

    expect(markdown).toContain('### Step 1');
    expect(markdown).toContain('- **click_element** (intent: open menu)');
    expect(markdown).toContain('  Result: opened');
  });
});

describe('parseAgentStepHistory', () => {
  it('pairs each model action with its result and keeps the errors', () => {
    const raw = JSON.stringify({
      history: [
        {
          modelOutput: JSON.stringify({
            current_state: {},
            action: [{ click_element: { intent: 'click go', index: 0 } }, { done: { text: 'ok' } }],
          }),
          result: [
            { extractedContent: 'clicked', error: null, success: true },
            { extractedContent: null, error: 'element gone', success: false },
          ],
          state: { url: 'https://example.com/a', title: 'A' },
        },
      ],
    });

    const steps = parseAgentStepHistory(raw);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ index: 1, url: 'https://example.com/a', title: 'A' });
    expect(steps[0].actions).toEqual([
      { name: 'click_element', intent: 'click go', result: 'clicked', error: null },
      { name: 'done', intent: '', result: '', error: 'element gone' },
    ]);
  });

  it('returns no steps for unreadable or unrelated JSON', () => {
    expect(parseAgentStepHistory('not json')).toEqual([]);
    expect(parseAgentStepHistory('{"other": 1}')).toEqual([]);
  });
});
