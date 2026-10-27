import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CliTaskRunner, isValidTaskId, systemPromptFor } from './runner';
import { BridgeError, type CliRunner } from '../protocol';

const FIXTURES = join(__dirname, '..', '..', '..', 'lib', 'cli', 'fixtures');

/** A stand-in CLI: node prints a fixture file to stdout, ignoring the runner's own flags. */
function fakeCli(fixture: string) {
  return () => ({
    file: process.execPath,
    prefixArgs: [
      '-e',
      "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))",
      join(FIXTURES, fixture),
    ],
  });
}

describe('CliTaskRunner', () => {
  let stateDir = '';

  before(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'qagent-cli-'));
  });

  after(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  function runnerWith(fixture: string, runner: CliRunner = 'codex'): CliTaskRunner {
    return new CliTaskRunner({
      stateDir,
      binPath: join(stateDir, 'bin.js'),
      resolve: (requested: CliRunner) => (requested === runner ? fakeCli(fixture)() : null),
    });
  }

  it('emits each step as it arrives and returns the final answer', async () => {
    const steps: string[] = [];
    const result = await runnerWith('codex-success.jsonl').run(
      { taskId: 't1', runner: 'codex', task: 'check the page' },
      (taskId, state, details) => steps.push(`${taskId} ${state} ${details}`),
    );
    assert.deepEqual(result, { ok: true, text: 'The page has one button and it works.' });
    assert.equal(steps.length, 4);
    assert.equal(steps[0], 't1 act.start page_info {}');
  });

  it('returns a failed result with the CLI error instead of rejecting', async () => {
    const result = await runnerWith('codex-turn-failed.jsonl').run(
      { taskId: 't2', runner: 'codex', task: 'check the page' },
      () => {},
    );
    assert.deepEqual(result, { ok: false, text: '', error: 'model rejected the request' });
  });

  it('reports a missing CLI without spawning anything', async () => {
    const runner = new CliTaskRunner({ stateDir, binPath: 'bin.js', resolve: () => null });
    const result = await runner.run({ taskId: 't3', runner: 'claude', task: 'x' }, () => {});
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /not found on PATH/);
  });

  it('refuses a task id that would escape the state directory before writing anything', () => {
    const nested = join(stateDir, 'nested');
    mkdirSync(nested, { recursive: true });
    const runner = new CliTaskRunner({ stateDir: nested, binPath: 'bin.js', resolve: fakeCli('claude-success.jsonl') });
    assert.throws(
      () => runner.run({ taskId: '../escaped', runner: 'claude', task: 'x' }, () => {}),
      (error: unknown) => error instanceof BridgeError && error.code === 'INVALID_PARAMS',
    );
    assert.equal(existsSync(join(nested, 'escaped.mcp.json')), false);
    assert.equal(existsSync(join(stateDir, 'escaped.mcp.json')), false);
  });

  it('accepts UUIDs and plain tokens as task ids, and refuses separators, dots, blanks and overlong ids', () => {
    assert.equal(isValidTaskId('3f2c9a1e-7b4d-4c8a-9e21-5d6f7a8b9c0d'), true);
    assert.equal(isValidTaskId('task_1-B'), true);
    for (const id of ['', '..', '../x', 'a/b', 'a\\b', 'a.b', 'a b', 'x'.repeat(129)]) {
      assert.equal(isValidTaskId(id), false, id);
    }
    assert.equal(isValidTaskId(42), false);
  });

  it('builds a system prompt that names the target tab', () => {
    assert.match(systemPromptFor(42), /tab 42/);
    assert.match(systemPromptFor(undefined), /active tab/);
  });
});
