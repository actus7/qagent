import { describe, expect, it } from 'vitest';
import { chunkEnd, decodeCursor, digestText, encodeCursor, readTextChunk } from '../text-chunks';

describe('digestText', () => {
  it('is stable and sensitive to every character', () => {
    expect(digestText('abc')).toBe(digestText('abc'));
    expect(digestText('abc')).not.toBe(digestText('abd'));
    expect(digestText('abc')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('chunkEnd', () => {
  it('returns the end of the text when it fits', () => {
    expect(chunkEnd('short text', 0, 100)).toBe(10);
  });

  it('cuts after the last sentence that fits, not mid-sentence', () => {
    const text = 'First sentence here. Second sentence follows. Third one is longer than the budget allows.';
    const end = chunkEnd(text, 0, 60);
    expect(text.slice(0, end).trim().endsWith('.')).toBe(true);
    expect(end).toBeLessThanOrEqual(60);
  });

  it('prefers a paragraph break over a sentence end when it is past half the budget', () => {
    const text = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.\n\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(text.slice(0, chunkEnd(text, 0, 50)).trimEnd()).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.');
  });

  it('hard-cuts when no boundary exists', () => {
    expect(chunkEnd('x'.repeat(50), 0, 20)).toBe(20);
  });
});

describe('cursor encoding', () => {
  it('round-trips offset and digest and rejects malformed cursors', () => {
    const cursor = encodeCursor(42, 'delivered text');
    expect(decodeCursor(cursor)).toEqual({ offset: 42, digest: digestText('delivered text') });
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });
});

describe('readTextChunk', () => {
  const full = 'Alpha beta gamma. Delta epsilon zeta. Eta theta iota. Kappa lambda mu.';

  it('reads from the top and returns a cursor while text remains', () => {
    const first = readTextChunk(full, { maxLength: 30 });
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    expect(first.offset).toBe(0);
    expect(first.totalLength).toBe(full.length);
    expect(first.cursor).not.toBeNull();
  });

  it('continues from a cursor until the cursor is null', () => {
    const parts: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const chunk = readTextChunk(full, { maxLength: 30, cursor });
      if (chunk.status !== 'ok') throw new Error(`unexpected ${chunk.status}`);
      parts.push(chunk.content);
      if (!chunk.cursor) break;
      cursor = chunk.cursor;
    }
    expect(parts.join(' ')).toBe(full);
  });

  it('reports stale when the text before the cursor changed', () => {
    const first = readTextChunk(full, { maxLength: 30 });
    if (first.status !== 'ok' || !first.cursor) throw new Error('expected a cursor');
    const edited = full.replace('Alpha', 'Omega');
    expect(readTextChunk(edited, { maxLength: 30, cursor: first.cursor })).toEqual({ status: 'stale' });
  });

  it('reports invalid for a cursor it did not issue', () => {
    expect(readTextChunk(full, { maxLength: 30, cursor: 'garbage' })).toEqual({ status: 'invalid' });
  });
});
