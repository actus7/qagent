import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeParser } from './claude';
import { createCodexParser } from './codex';
import type { CliEvent, StreamParser } from './types';

// Compiled tests run from dist/lib/cli; the fixtures stay in lib/cli/fixtures.
const FIXTURES = join(__dirname, '..', '..', '..', 'lib', 'cli', 'fixtures');

function replay(parser: StreamParser, fixture: string): CliEvent[] {
  const lines = readFileSync(join(FIXTURES, fixture), 'utf8').split('\n');
  const events = lines.flatMap(line => parser.consume(line));
  return [...events, ...parser.finish()];
}

describe('Claude stream-json parser', () => {
  it('reports each tool call as a step and returns the final result', () => {
    const events = replay(createClaudeParser(), 'claude-success.jsonl');
    assert.deepEqual(
      events.filter(event => event.type === 'step'),
      [
        { type: 'step', state: 'act.start', details: 'page_info {}' },
        { type: 'step', state: 'act.ok', details: 'page_info' },
        { type: 'step', state: 'act.start', details: 'page_click {"index":4}' },
        { type: 'step', state: 'act.fail', details: 'page_click' },
      ],
    );
    assert.deepEqual(events.at(-1), {
      type: 'done',
      ok: true,
      text: 'The title is QA target. The Go button did not respond.',
    });
  });

  it('fails the run when the qagent browser server did not start', () => {
    const events = replay(createClaudeParser(), 'claude-mcp-missing.jsonl');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'done');
    assert.equal(events[0].type === 'done' && events[0].ok, false);
    assert.match(events[0].type === 'done' ? (events[0].error ?? '') : '', /did not start \(failed\)/);
  });

  it('fails when the stream ends without a result', () => {
    const parser = createClaudeParser();
    parser.consume('{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}');
    assert.deepEqual(parser.finish(), [
      { type: 'done', ok: false, text: '', error: 'Claude Code exited without a result' },
    ]);
  });
});

describe('Codex exec --json parser', () => {
  it('maps tool and shell items to steps; a nonzero exit is a failed step', () => {
    const events = replay(createCodexParser(), 'codex-success.jsonl');
    assert.deepEqual(
      events.filter(event => event.type === 'step'),
      [
        { type: 'step', state: 'act.start', details: 'page_info {}' },
        { type: 'step', state: 'act.ok', details: 'page_info {}' },
        { type: 'step', state: 'act.start', details: 'shell: echo ok' },
        { type: 'step', state: 'act.fail', details: 'shell: echo ok' },
      ],
    );
    assert.deepEqual(events.at(-1), { type: 'done', ok: true, text: 'The page has one button and it works.' });
  });

  it('reports the turn error, not the transient stream error that came before it', () => {
    const events = replay(createCodexParser(), 'codex-turn-failed.jsonl');
    assert.deepEqual(events, [{ type: 'done', ok: false, text: '', error: 'model rejected the request' }]);
  });
});
