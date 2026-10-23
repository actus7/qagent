import { describe, expect, it } from 'vitest';
import { centerOfBox, isInsideViewport, parseJpegSize, screenshotPointToCss } from '../page-pointer';
import { JS_RESULT_MAX_CHARS, formatEvaluationResponse, withTimeout } from '../page-script';

// Minimal JPEG head: SOI, an APP0 segment, then SOF0 declaring 800x600.
const JPEG_800x600 = Uint8Array.from([
  0xff,
  0xd8, // SOI
  0xff,
  0xe0,
  0x00,
  0x04,
  0x00,
  0x00, // APP0, length 4 (no payload beyond length)
  0xff,
  0xc0,
  0x00,
  0x0b,
  0x08,
  0x02,
  0x58,
  0x03,
  0x20,
  0x01,
  0x01, // SOF0: height 0x0258=600, width 0x0320=800
]);

describe('parseJpegSize', () => {
  it('reads width and height from the start-of-frame segment', () => {
    expect(parseJpegSize(JPEG_800x600)).toEqual({ width: 800, height: 600 });
  });

  it('rejects bytes that are not a JPEG', () => {
    expect(parseJpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBeNull();
  });
});

describe('screenshot coordinate mapping', () => {
  it('scales screenshot pixels to viewport CSS pixels (device pixel ratio 2)', () => {
    const css = screenshotPointToCss({ x: 400, y: 300 }, { width: 1600, height: 1200 }, { width: 800, height: 600 });
    expect(css).toEqual({ x: 200, y: 150 });
  });

  it('uses the point unchanged when no screenshot size is known', () => {
    expect(screenshotPointToCss({ x: 120, y: 80 }, null, { width: 800, height: 600 })).toEqual({ x: 120, y: 80 });
  });

  it('detects points outside the viewport', () => {
    const viewport = { width: 800, height: 600 };
    expect(isInsideViewport({ x: 0, y: 0 }, viewport)).toBe(true);
    expect(isInsideViewport({ x: 799, y: 599 }, viewport)).toBe(true);
    expect(isInsideViewport({ x: 800, y: 10 }, viewport)).toBe(false);
    expect(isInsideViewport({ x: -1, y: 10 }, viewport)).toBe(false);
  });

  it('returns the center of a bounding box', () => {
    expect(centerOfBox({ x: 10, y: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 });
  });
});

describe('formatEvaluationResponse', () => {
  it('returns JSON for serialisable values', () => {
    expect(formatEvaluationResponse({ result: { type: 'object', value: { a: 1 } } })).toEqual({
      ok: true,
      text: '{"a":1}',
    });
  });

  it('describes values JSON cannot carry', () => {
    expect(formatEvaluationResponse({ result: { type: 'number', unserializableValue: 'NaN' } })).toEqual({
      ok: true,
      text: 'NaN',
    });
    expect(formatEvaluationResponse({ result: { type: 'object', description: 'HTMLDivElement' } })).toEqual({
      ok: true,
      text: 'HTMLDivElement',
    });
  });

  it('reports exceptions as text', () => {
    const outcome = formatEvaluationResponse({
      result: { type: 'object' },
      exceptionDetails: { text: 'Uncaught', exception: { description: 'ReferenceError: x is not defined' } },
    });
    expect(outcome).toEqual({ ok: false, text: 'ReferenceError: x is not defined' });
  });

  it('truncates long output', () => {
    const outcome = formatEvaluationResponse({
      result: { type: 'string', value: 'x'.repeat(JS_RESULT_MAX_CHARS + 50) },
    });
    expect(outcome.text.endsWith('...[truncated]')).toBe(true);
    expect(outcome.text.length).toBeLessThan(JS_RESULT_MAX_CHARS + 20);
  });
});

describe('withTimeout', () => {
  it('resolves with the work result when it finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 100, () => {})).resolves.toBe(42);
  });

  it('rejects and runs the timeout hook when work hangs', async () => {
    let stopped = false;
    await expect(withTimeout(new Promise<never>(() => {}), 10, () => (stopped = true))).rejects.toThrow(
      'timed out after 10 ms',
    );
    expect(stopped).toBe(true);
  });
});
