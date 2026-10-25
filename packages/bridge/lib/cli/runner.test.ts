import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CliTaskRunner, systemPromptFor } from './runner';
import type { CliRunner } from '../protocol';

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

  it('builds a system prompt that names the target tab', () => {
    assert.match(systemPromptFor(42), /tab 42/);
    assert.match(systemPromptFor(undefined), /active tab/);
  });
});
