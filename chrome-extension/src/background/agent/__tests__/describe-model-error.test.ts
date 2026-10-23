import { describe, expect, it } from 'vitest';
import { describeModelError } from '../agents/errors';

const translate = (key: string) => `<${key}>`;

describe('describeModelError', () => {
  it('maps provider failures to actionable messages', () => {
    expect(describeModelError(new Error('401 Incorrect API key provided'), translate)).toBe('<bg_errors_modelAuth>');
    expect(describeModelError(new Error('429 Too Many Requests'), translate)).toBe('<bg_errors_modelRateLimit>');
    expect(describeModelError(new Error('404 The model `gpt-x` does not exist'), translate)).toBe(
      '<bg_errors_modelNotFound>',
    );
    expect(describeModelError(new TypeError('Failed to fetch'), translate)).toBe('<bg_errors_modelUnreachable>');
  });

  it('keeps unknown errors but drops the LangChain troubleshooting link', () => {
    const error = new Error('Something odd\n\nTroubleshooting URL: https://docs.langchain.com/x/');
    expect(describeModelError(error, translate)).toBe('Something odd');
  });
});

describe('describeModelError scope', () => {
  it('does not blame the model for a page returning 404', () => {
    expect(describeModelError(new Error('Navigation failed: page answered 404'), translate)).toBe(
      'Navigation failed: page answered 404',
    );
  });
});
