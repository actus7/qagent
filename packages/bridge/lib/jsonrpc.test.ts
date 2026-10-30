import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clientNameOf } from './jsonrpc';

describe('clientNameOf', () => {
  it('reads clientInfo.name from an initialize request', () => {
    const message = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } };
    assert.equal(clientNameOf(message), 'claude-code');
  });

  it('ignores other methods, malformed names and missing info', () => {
    assert.equal(clientNameOf({ method: 'tools/call', params: { clientInfo: { name: 'codex' } } }), undefined);
    assert.equal(clientNameOf({ method: 'initialize', params: { clientInfo: { name: 42 } } }), undefined);
    assert.equal(clientNameOf({ method: 'initialize', params: {} }), undefined);
    assert.equal(clientNameOf('initialize'), undefined);
  });

  it('trims the name and cuts it to the extension limit', () => {
    const long = `  ${'x'.repeat(200)}  `;
    const name = clientNameOf({ method: 'initialize', params: { clientInfo: { name: long } } });
    assert.equal(name?.length, 128);
    assert.equal(clientNameOf({ method: 'initialize', params: { clientInfo: { name: '   ' } } }), undefined);
  });
});
