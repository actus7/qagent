import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runHostTool } from './host';
import { BridgeError } from './protocol';

describe('host tools', () => {
  let dir = '';

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'qagent-host-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('shell_exec returns the exit code and output of a harmless command', async () => {
    const result = (await runHostTool('shell_exec', { command: 'echo qagent-ok', cwd: dir })) as {
      exitCode: number;
      stdout: string;
      timedOut: boolean;
    };
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.match(result.stdout, /qagent-ok/);
  });

  it('fs_write creates parent folders and fs_read returns numbered window of lines', async () => {
    const file = join(dir, 'nested', 'notes.txt');
    await runHostTool('fs_write', { path: file, content: 'alpha\nbeta\ngamma\n' });
    assert.equal(readFileSync(file, 'utf8'), 'alpha\nbeta\ngamma\n');
    const read = (await runHostTool('fs_read', { path: file, offset: 1, limit: 1 })) as {
      content: string;
      startLine: number;
      totalLines: number;
    };
    assert.equal(read.content, 'beta');
    assert.equal(read.startLine, 2);
    assert.equal(read.totalLines, 4);
  });

  it('fs_list reports files and folders sorted by name', async () => {
    writeFileSync(join(dir, 'b.txt'), 'b');
    const listed = (await runHostTool('fs_list', { path: dir })) as { entries: { name: string; type: string }[] };
    const names = listed.entries.map(entry => entry.name);
    assert.deepEqual(
      names,
      [...names].sort((a, b) => a.localeCompare(b)),
    );
    assert.ok(listed.entries.some(entry => entry.name === 'nested' && entry.type === 'dir'));
    assert.ok(listed.entries.some(entry => entry.name === 'b.txt' && entry.type === 'file'));
  });

  it('fs_search finds substring and regex matches and skips node_modules', async () => {
    writeFileSync(join(dir, 'code.ts'), 'const needle = 1;\nconst other = 2;\n');
    const nodeModules = join(dir, 'node_modules');
    await runHostTool('fs_write', { path: join(nodeModules, 'x.js'), content: 'needle' });
    const found = (await runHostTool('fs_search', { path: dir, pattern: 'needle' })) as {
      matches: { file: string; line: number }[];
    };
    assert.deepEqual(
      found.matches.map(match => [match.file, match.line]),
      [['code.ts', 1]],
    );
    const regex = (await runHostTool('fs_search', { path: dir, pattern: 'const \\w+ = 2', regex: true })) as {
      matches: { line: number }[];
    };
    assert.equal(regex.matches[0].line, 2);
  });

  it('fs_search matches literal text unless regex is requested', async () => {
    const sub = join(dir, 'literal-search');
    mkdirSync(sub);
    writeFileSync(join(sub, 'lines.txt'), 'abc\na.c\n');
    const literal = (await runHostTool('fs_search', { path: sub, pattern: 'a.c' })) as {
      matches: { line: number }[];
    };
    assert.deepEqual(
      literal.matches.map(match => match.line),
      [2],
    );
    const regex = (await runHostTool('fs_search', { path: sub, pattern: 'a.c', regex: true })) as {
      matches: { line: number }[];
    };
    assert.deepEqual(
      regex.matches.map(match => match.line),
      [1, 2],
    );
  });

  it('fs_search refuses long or non-compiling regex patterns and a non-boolean regex flag', async () => {
    const isInvalidParams = (error: unknown) => error instanceof BridgeError && error.code === 'INVALID_PARAMS';
    await assert.rejects(runHostTool('fs_search', { path: dir, pattern: '(', regex: true }), isInvalidParams);
    await assert.rejects(runHostTool('fs_search', { path: dir, pattern: 'a'.repeat(201), regex: true }), isInvalidParams);
    await assert.rejects(runHostTool('fs_search', { path: dir, pattern: 'a', regex: 'yes' }), isInvalidParams);
  });

  it('fs_search applies regex to the first 300 characters of a line and never backtracks on literal text', async () => {
    const sub = join(dir, 'long-lines');
    mkdirSync(sub);
    writeFileSync(join(sub, 'long.txt'), `${'x'.repeat(400)}needle\n${'a'.repeat(5000)}!\n`);
    const literal = (await runHostTool('fs_search', { path: sub, pattern: 'needle' })) as { matches: unknown[] };
    assert.equal(literal.matches.length, 1);
    const regex = (await runHostTool('fs_search', { path: sub, pattern: 'needle', regex: true })) as {
      matches: unknown[];
    };
    assert.equal(regex.matches.length, 0);
    const catastrophic = (await runHostTool('fs_search', { path: sub, pattern: '(a+)+$' })) as { matches: unknown[] };
    assert.equal(catastrophic.matches.length, 0);
  });

  it('refuses unknown methods and bad parameters with stable codes', async () => {
    await assert.rejects(runHostTool('shell_sudo', {}), (error: unknown) => {
      return error instanceof BridgeError && error.code === 'INVALID_REQUEST';
    });
    await assert.rejects(runHostTool('fs_read', { path: '' }), (error: unknown) => {
      return error instanceof BridgeError && error.code === 'INVALID_PARAMS';
    });
  });
});
