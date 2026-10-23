import { describe, expect, it } from 'vitest';
import {
  CONTEXT_PREFILL_TTL_MS,
  formatContextPrefill,
  isContextPrefillPayload,
  readStoredContextPrefill,
} from '@extension/shared';
import { ASK_QAGENT_MENU_ID, buildContextPrefill } from '../context-menu';

const tab = { id: 42, windowId: 3, url: 'https://example.com/a', title: 'Example' } as chrome.tabs.Tab;

describe('buildContextPrefill', () => {
  it('builds a prefill from a selection click on a page', () => {
    const payload = buildContextPrefill(
      { menuItemId: ASK_QAGENT_MENU_ID, pageUrl: 'https://example.com/a', selectionText: '  quoted text  ' },
      tab,
    );
    expect(payload).toEqual({
      tabId: 42,
      pageUrl: 'https://example.com/a',
      pageTitle: 'Example',
      selectionText: 'quoted text',
    });
  });

  it('keeps http link and image URLs and drops non-web ones', () => {
    const withLink = buildContextPrefill(
      { menuItemId: ASK_QAGENT_MENU_ID, linkUrl: 'https://docs.example.com', srcUrl: 'data:image/png;base64,AAAA' },
      tab,
    );
    expect(withLink?.linkUrl).toBe('https://docs.example.com');
    expect(withLink?.imageUrl).toBeUndefined();

    const mailto = buildContextPrefill({ menuItemId: ASK_QAGENT_MENU_ID, linkUrl: 'mailto:a@b.c' }, tab);
    expect(mailto?.linkUrl).toBeUndefined();
  });

  it('truncates very long selections instead of rejecting them', () => {
    const payload = buildContextPrefill({ menuItemId: ASK_QAGENT_MENU_ID, selectionText: 'x'.repeat(9000) }, tab);
    expect(payload?.selectionText?.length).toBe(4000);
  });

  it('returns null when the click has no tab id', () => {
    expect(buildContextPrefill({ menuItemId: ASK_QAGENT_MENU_ID }, undefined)).toBeNull();
    expect(buildContextPrefill({ menuItemId: ASK_QAGENT_MENU_ID }, { windowId: 1 } as chrome.tabs.Tab)).toBeNull();
  });
});

describe('isContextPrefillPayload', () => {
  const valid = { tabId: 1, pageUrl: 'https://a.test', pageTitle: 'A' };

  it('accepts a well-formed payload', () => {
    expect(isContextPrefillPayload(valid)).toBe(true);
    expect(isContextPrefillPayload({ ...valid, linkUrl: 'https://b.test', selectionText: 'x' })).toBe(true);
  });

  it('rejects malformed shapes', () => {
    expect(isContextPrefillPayload(null)).toBe(false);
    expect(isContextPrefillPayload({ ...valid, tabId: -1 })).toBe(false);
    expect(isContextPrefillPayload({ ...valid, tabId: 1.5 })).toBe(false);
    expect(isContextPrefillPayload({ ...valid, tabId: '1' })).toBe(false);
    expect(isContextPrefillPayload({ ...valid, pageTitle: undefined })).toBe(false);
    expect(isContextPrefillPayload({ ...valid, linkUrl: 'javascript:alert(1)' })).toBe(false);
    expect(isContextPrefillPayload({ ...valid, imageUrl: 'data:image/png;base64,AA' })).toBe(false);
    expect(isContextPrefillPayload({ ...valid, selectionText: 'x'.repeat(4001) })).toBe(false);
  });
});

describe('readStoredContextPrefill', () => {
  const payload = { tabId: 1, pageUrl: 'https://a.test', pageTitle: 'A' };

  it('returns a fresh payload and drops stale or malformed ones', () => {
    const now = 1_000_000;
    expect(readStoredContextPrefill({ payload, createdAt: now - 1000 }, now)).toEqual(payload);
    expect(readStoredContextPrefill({ payload, createdAt: now - CONTEXT_PREFILL_TTL_MS - 1 }, now)).toBeNull();
    expect(readStoredContextPrefill({ payload: { tabId: 'x' }, createdAt: now }, now)).toBeNull();
    expect(readStoredContextPrefill('nope', now)).toBeNull();
  });
});

describe('formatContextPrefill', () => {
  const labels = { page: 'Página', link: 'Link', image: 'Imagem', selection: 'Seleção' };

  it('quotes the selection and lists page, link and image references', () => {
    const text = formatContextPrefill(
      {
        tabId: 1,
        pageUrl: 'https://a.test',
        pageTitle: 'A',
        selectionText: 'first\nsecond',
        linkUrl: 'https://b.test',
        imageUrl: 'https://c.test/i.png',
      },
      labels,
    );
    expect(text).toBe(
      'Seleção:\n> first\n> second\n\nPágina: A (https://a.test)\nLink: https://b.test\nImagem: https://c.test/i.png\n\n',
    );
  });

  it('falls back to the URL when the page has no title', () => {
    const text = formatContextPrefill({ tabId: 1, pageUrl: 'https://a.test', pageTitle: '' }, labels);
    expect(text).toBe('Página: https://a.test (https://a.test)\n\n');
  });
});
