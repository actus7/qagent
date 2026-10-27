// Host tools: shell and file access on the machine running the daemon. The product has no approval gates,
// so these run whatever they are asked. Output is capped so one call cannot flood the model's context.
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { BridgeError, type McpBridgeHostMethod } from './protocol';

export const OUTPUT_LIMIT_CHARS = 64 * 1024;
const SHELL_DEFAULT_TIMEOUT_MS = 60_000;
const SHELL_MAX_TIMEOUT_MS = 600_000;
const READ_DEFAULT_LINES = 200;
const READ_MAX_LINES = 2000;
const LIST_MAX_ENTRIES = 500;
const SEARCH_DEFAULT_RESULTS = 100;
const SEARCH_MAX_RESULTS = 500;
const SEARCH_MAX_FILES = 20_000;
const SEARCH_MAX_FILE_BYTES = 1024 * 1024;
const WRITE_MAX_CHARS = 2_000_000;
const SKIPPED_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git']);

type Params = Record<string, unknown>;

function invalid(message: string): never {
  throw new BridgeError('INVALID_PARAMS', message);
}

function readString(params: Params, key: string, min: number, max: number): string {
  const value = params[key];
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    invalid(`${key} must be a string of ${min} to ${max} characters`);
  }
  return value;
}

function readOptionalString(params: Params, key: string, max: number): string | undefined {
  return params[key] === undefined ? undefined : readString(params, key, 1, max);
}

function readInt(params: Params, key: string, min: number, max: number, fallback: number): number {
  const value = params[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid(`${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/** Caps text to the limit and says so, so the model knows the output was cut. */
function capText(text: string, limit = OUTPUT_LIMIT_CHARS): { text: string; truncated: boolean } {
  return text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text, truncated: false };
}

export interface ShellOutcome {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

/** PowerShell on Windows, bash elsewhere. The command travels as one argv element, never through a shell. */
export function shellInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
): {
  file: string;
  args: string[];
} {
  if (platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] };
  }
  return { file: 'bash', args: ['-c', command] };
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // A PowerShell child can outlive its parent; taskkill /T takes the whole tree.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  child.kill('SIGKILL');
}

export function runShell(params: Params): Promise<ShellOutcome> {
  const command = readString(params, 'command', 1, 8000);
  const cwd = readOptionalString(params, 'cwd', 1024) ?? homedir();
  const timeoutMs = readInt(params, 'timeoutMs', 1000, SHELL_MAX_TIMEOUT_MS, SHELL_DEFAULT_TIMEOUT_MS);
  const { file, args } = shellInvocation(command);
  return new Promise(resolve => {
    const child = spawn(file, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let timedOut = false;
    const collect = (stream: 'stdout' | 'stderr') => (text: string) => {
      // Keep reading past the cap so the child never blocks on a full pipe; the text is just not stored.
      if (sizes[stream] >= OUTPUT_LIMIT_CHARS) return;
      chunks[stream].push(text);
      sizes[stream] += text.length;
    };
    // Decoding per chunk would split a multi-byte character that crosses a chunk boundary; the stream decodes instead.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);
    const finish = (exitCode: number | null, extraStderr = '') => {
      clearTimeout(timer);
      const stdout = capText(chunks.stdout.join(''));
      const stderr = capText(`${chunks.stderr.join('')}${extraStderr}`);
      resolve({
        exitCode,
        timedOut,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated || sizes.stdout > OUTPUT_LIMIT_CHARS,
      });
    };
    child.on('error', error => finish(null, error.message));
    child.on('close', code => finish(code));
  });
}

function resolvePath(params: Params, key = 'path'): string {
  return path.resolve(readString(params, key, 1, 1024));
}

export async function readFile(params: Params): Promise<unknown> {
  const file = resolvePath(params);
  const offset = readInt(params, 'offset', 0, 1_000_000_000, 0);
  const limit = readInt(params, 'limit', 1, READ_MAX_LINES, READ_DEFAULT_LINES);
  const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/);
  const content = capText(lines.slice(offset, offset + limit).join('\n'));
  return {
    path: file,
    totalLines: lines.length,
    startLine: offset + 1,
    content: content.text,
    truncated: content.truncated || offset + limit < lines.length,
  };
}

export async function writeFile(params: Params): Promise<unknown> {
  const file = resolvePath(params);
  const content = readString(params, 'content', 0, WRITE_MAX_CHARS);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
  return { path: file, bytes: Buffer.byteLength(content, 'utf8') };
}

export async function listDirectory(params: Params): Promise<unknown> {
  const dir = resolvePath(params);
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries = dirents
    .map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: dir,
    entries: entries.slice(0, LIST_MAX_ENTRIES),
    truncated: entries.length > LIST_MAX_ENTRIES,
  };
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

/** A regex when the pattern compiles, otherwise the pattern as a literal. */
function searchExpression(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

export async function searchFiles(params: Params): Promise<unknown> {
  const root = resolvePath(params);
  const pattern = readString(params, 'pattern', 1, 500);
  const maxResults = readInt(params, 'maxResults', 1, SEARCH_MAX_RESULTS, SEARCH_DEFAULT_RESULTS);
  const expression = searchExpression(pattern);
  const matches: SearchMatch[] = [];
  const pending = [root];
  let visited = 0;
  let truncated = false;
  while (pending.length > 0 && !truncated) {
    const dir = pending.pop() as string;
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of dirents) {
      if (entry.isSymbolicLink() || SKIPPED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
        continue;
      }
      if (!entry.isFile() || ++visited > SEARCH_MAX_FILES) continue;
      const found = await searchFile(full, expression, maxResults - matches.length, root);
      matches.push(...found.matches);
      if (matches.length >= maxResults) {
        truncated = true;
        break;
      }
    }
  }
  return { root, pattern, matches, truncated };
}

async function searchFile(
  file: string,
  expression: RegExp,
  budget: number,
  root: string,
): Promise<{ matches: SearchMatch[] }> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat || stat.size > SEARCH_MAX_FILE_BYTES) return { matches: [] };
  const buffer = await fs.readFile(file);
  // A NUL byte marks a binary file; its text is noise for the model.
  if (buffer.includes(0)) return { matches: [] };
  const matches: SearchMatch[] = [];
  const lines = buffer.toString('utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length && matches.length < budget; index += 1) {
    if (expression.test(lines[index])) {
      matches.push({ file: path.relative(root, file), line: index + 1, text: lines[index].slice(0, 300) });
    }
  }
  return { matches };
}

/** Runs one host tool. Unknown method names are refused with INVALID_REQUEST. */
export async function runHostTool(method: McpBridgeHostMethod | string, params: Params): Promise<unknown> {
  switch (method) {
    case 'shell_exec':
      return runShell(params);
    case 'fs_read':
      return readFile(params);
    case 'fs_write':
      return writeFile(params);
    case 'fs_list':
      return listDirectory(params);
    case 'fs_search':
      return searchFiles(params);
    default:
      throw new BridgeError('INVALID_REQUEST', `Unsupported host tool: ${method}`);
  }
}
