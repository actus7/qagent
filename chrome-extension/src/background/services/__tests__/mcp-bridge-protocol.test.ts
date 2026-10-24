import { describe, expect, it } from 'vitest';
import { extractRequestId, parseBridgeRequest } from '../mcpBridge/protocol';

const frame = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'request', id: 'req-1', method: 'run_task', params: { task: 'Abrir o carrinho' }, ...overrides });

describe('parseBridgeRequest', () => {
  it('accepts a run_task request and applies the defaults', () => {
    const parsed = parseBridgeRequest(frame());
    expect(parsed).toEqual({
      id: 'req-1',
      method: 'run_task',
      params: { task: 'Abrir o carrinho', mode: 'act' },
    });
  });

  it('rejects frames that are not JSON or not request frames', () => {
    expect(() => parseBridgeRequest('{not json')).toThrow('not valid JSON');
    expect(() => parseBridgeRequest(frame({ type: 'hello' }))).toThrow('malformed');
    expect(() => parseBridgeRequest(frame({ extra: true }))).toThrow('malformed');
  });

  it('rejects unknown methods', () => {
    expect(() => parseBridgeRequest(frame({ method: 'eval_js' }))).toThrow('malformed');
  });

  it('rejects run_task params it does not know, so arbitrary actions cannot be smuggled in', () => {
    const withAction = frame({ params: { task: 'x', action: 'execute_javascript' } });
    expect(() => parseBridgeRequest(withAction)).toThrow();
  });

  it('validates task length, mode and url scheme', () => {
    expect(() => parseBridgeRequest(frame({ params: { task: '   ' } }))).toThrow();
    expect(() => parseBridgeRequest(frame({ params: { task: 'x'.repeat(8001) } }))).toThrow();
    expect(() => parseBridgeRequest(frame({ params: { task: 'x', mode: 'plan-everything' } }))).toThrow();
    // The permission choice is gone: the agent always runs as auto, so the field is rejected.
    expect(() => parseBridgeRequest(frame({ params: { task: 'x', permission: 'auto' } }))).toThrow();
    expect(() => parseBridgeRequest(frame({ params: { task: 'x', url: 'javascript:alert(1)' } }))).toThrow();
    expect(() => parseBridgeRequest(frame({ params: { task: 'x', url: 'file:///etc/passwd' } }))).toThrow();
    expect(parseBridgeRequest(frame({ params: { task: 'x', url: 'https://example.com' } })))
      .toMatchObject({ params: { url: 'https://example.com' } });
  });

  it('accepts list, status and cancel requests only with empty params', () => {
    for (const method of ['list_tabs', 'get_status', 'cancel_task']) {
      expect(parseBridgeRequest(frame({ method, params: {} }))).toEqual({ id: 'req-1', method, params: {} });
    }
    expect(() => parseBridgeRequest(frame({ method: 'list_tabs', params: { tabId: 1 } }))).toThrow();
  });
});

describe('extractRequestId', () => {
  it('returns a usable id so an invalid frame can still be answered', () => {
    expect(extractRequestId({ id: 'abc' })).toBe('abc');
    expect(extractRequestId({ id: 42 })).toBeNull();
    expect(extractRequestId({ id: '' })).toBeNull();
    expect(extractRequestId(null)).toBeNull();
  });
});
