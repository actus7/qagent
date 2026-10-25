import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentContext } from '../../types';
import { createWebFetchAction, htmlToText } from '../web-fetch';

function createContext() {
  const eventManager = {
    emit: async () => undefined,
  };
  return new AgentContext('task-1', {} as never, {} as never, eventManager as never, {});
}

function stubFetchResponse(body: string, init: { status?: number; contentType: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(body, { status: init.status ?? 200, headers: { 'Content-Type': init.contentType } }),
    ),
  );
}

const callFetch = (overrides: Partial<{ url: string; format: 'text' | 'html' | 'json'; maxLength: number }> = {}) =>
  createWebFetchAction(createContext()).call({
    url: 'https://example.test/page',
    format: 'text',
    maxLength: 20000,
    ...overrides,
  });

describe('htmlToText', () => {
  it('drops scripts, styles and tags, and decodes entities once', () => {
    const html =
      '<html><head><style>p { color: red }</style></head><body><script>alert(1)</script>' +
      '<h1>Title</h1><p>Tom &amp; Jerry &lt;3 &amp;lt;</p></body></html>';

    const text = htmlToText(html);

    expect(text).toContain('Title');
    expect(text).toContain('Tom & Jerry <3 &lt;');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('<h1>');
  });
});

describe('web_fetch action', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the page as text and cuts it to maxLength', async () => {
    const paragraph = '<p>' + 'word '.repeat(200) + '</p>';
    stubFetchResponse(`<html><body>${paragraph}</body></html>`, { contentType: 'text/html; charset=utf-8' });

    const result = await callFetch({ maxLength: 100 });

    expect(result.error).toBeNull();
    expect(result.extractedContent).toContain('...[truncated]');
    expect(result.extractedContent).not.toContain('<p>');
  });

  it('pretty-prints a JSON body', async () => {
    stubFetchResponse('{"a":1,"b":[2]}', { contentType: 'application/json' });

    const result = await callFetch({ format: 'json' });

    expect(result.extractedContent).toContain('"a": 1');
  });

  it('reports invalid JSON as an error result', async () => {
    stubFetchResponse('not json', { contentType: 'application/json' });

    const result = await callFetch({ format: 'json' });

    expect(result.error).toContain('not valid JSON');
  });

  it('reports an HTTP error status as an error result', async () => {
    stubFetchResponse('missing', { status: 404, contentType: 'text/plain' });

    const result = await callFetch();

    expect(result.error).toContain('HTTP 404');
  });
});
