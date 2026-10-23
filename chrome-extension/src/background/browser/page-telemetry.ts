import type {
  ConsoleMessage,
  HTTPRequest,
  HTTPResponse,
  Page as PuppeteerPage,
} from 'puppeteer-core/internal/puppeteer-core-browser.js';

export const CONSOLE_BUFFER_SIZE = 200;
export const NETWORK_BUFFER_SIZE = 200;
export const DEFAULT_READ_LIMIT = 50;
export const MAX_READ_LIMIT = 200;
const MAX_TEXT_LENGTH = 500;
const MAX_URL_LENGTH = 500;
// Requests that never settle (long polls, streams) must not grow the in-flight map without bound.
const MAX_PENDING_REQUESTS = 500;
const REDACTED_VALUE = 'REDACTED';

// Query parameter names that may carry credentials. Matched case-insensitively against the parameter name.
const SENSITIVE_PARAM_PATTERN =
  /token|key|auth|pass|pwd|secret|session|credential|jwt|cookie|otp|(^|[^a-z])sig(nature)?([^a-z]|$)/i;

export type ConsoleLevel = 'log' | 'info' | 'warning' | 'error' | 'debug';

export interface ConsoleEntry {
  level: ConsoleLevel;
  text: string;
  timestamp: number;
}

export interface NetworkEntry {
  method: string;
  url: string;
  resourceType: string;
  status: number | null;
  mimeType: string | null;
  failure: string | null;
  durationMs: number | null;
  startedAt: number;
}

export interface ConsoleReadOptions {
  level?: ConsoleLevel | null;
  pattern?: string | null;
  limit?: number | null;
  clear?: boolean | null;
}

export interface NetworkReadOptions {
  urlPattern?: string | null;
  onlyFailed?: boolean | null;
  limit?: number | null;
  clear?: boolean | null;
}

/** Fixed-capacity buffer that keeps only the most recent items. */
export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    const overflow = this.items.length - this.capacity;
    if (overflow > 0) this.items.splice(0, overflow);
  }

  toArray(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }
}

export function truncateText(text: string, maxLength: number = MAX_TEXT_LENGTH): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function toConsoleLevel(type: string): ConsoleLevel {
  if (type === 'error' || type === 'assert') return 'error';
  if (type === 'warn' || type === 'warning') return 'warning';
  if (type === 'info') return 'info';
  if (type === 'debug' || type === 'verbose') return 'debug';
  return 'log';
}

/**
 * Removes credentials from a URL before it is stored or shown to the model:
 * userinfo is dropped, sensitive query values are replaced, and the fragment is removed.
 */
export function redactUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '[unparseable url]';
  }
  // Inline payloads can be large and are not useful for QA inspection.
  if (url.protocol === 'data:') return 'data:[omitted]';

  url.username = '';
  url.password = '';
  url.hash = '';
  const params = new URLSearchParams();
  url.searchParams.forEach((value, name) => {
    params.append(name, SENSITIVE_PARAM_PATTERN.test(name) ? REDACTED_VALUE : value);
  });
  url.search = params.toString();
  return truncateText(url.toString(), MAX_URL_LENGTH);
}

export function mimeTypeOf(contentType: string | undefined): string | null {
  const mimeType = contentType?.split(';')[0]?.trim().toLowerCase();
  return mimeType || null;
}

function matchesText(value: string, pattern: string | null | undefined): boolean {
  if (!pattern) return true;
  return value.toLowerCase().includes(pattern.toLowerCase());
}

export function normalizeLimit(limit: number | null | undefined): number {
  if (!limit || limit < 1) return DEFAULT_READ_LIMIT;
  return Math.min(Math.floor(limit), MAX_READ_LIMIT);
}

/** Returns the most recent matching entries, oldest first. */
export function filterConsoleEntries(entries: ConsoleEntry[], options: ConsoleReadOptions): ConsoleEntry[] {
  const matching = entries.filter(
    entry => (!options.level || entry.level === options.level) && matchesText(entry.text, options.pattern),
  );
  return matching.slice(-normalizeLimit(options.limit));
}

/** Returns the most recent matching entries, oldest first. */
export function filterNetworkEntries(entries: NetworkEntry[], options: NetworkReadOptions): NetworkEntry[] {
  const matching = entries.filter(entry => {
    if (!matchesText(entry.url, options.urlPattern)) return false;
    if (options.onlyFailed && !isFailedRequest(entry)) return false;
    return true;
  });
  return matching.slice(-normalizeLimit(options.limit));
}

export function isFailedRequest(entry: NetworkEntry): boolean {
  return entry.failure !== null || (entry.status !== null && entry.status >= 400);
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 19);
}

export function formatConsoleEntries(entries: ConsoleEntry[]): string {
  return entries.map(entry => `${formatClock(entry.timestamp)} [${entry.level}] ${entry.text}`).join('\n');
}

export function formatNetworkEntries(entries: NetworkEntry[]): string {
  return entries
    .map(entry => {
      const outcome =
        entry.failure !== null ? `FAILED (${entry.failure})` : entry.status !== null ? `${entry.status}` : 'pending';
      const duration = entry.durationMs !== null ? `${entry.durationMs}ms` : '-';
      const mime = entry.mimeType ?? '-';
      return `${entry.method} ${entry.url} -> ${outcome} [${entry.resourceType}, ${mime}, ${duration}]`;
    })
    .join('\n');
}

/**
 * Records console output, uncaught exceptions and HTTP requests of one tab while it is attached.
 * Only requests and messages after attach are visible; nothing is replayed.
 */
export class PageTelemetry {
  private readonly consoleBuffer = new RingBuffer<ConsoleEntry>(CONSOLE_BUFFER_SIZE);
  private readonly networkBuffer = new RingBuffer<NetworkEntry>(NETWORK_BUFFER_SIZE);
  private readonly pending = new Map<HTTPRequest, NetworkEntry>();
  private cleanups: Array<() => void> = [];

  attach(page: PuppeteerPage): void {
    this.detach();
    this.consoleBuffer.clear();
    this.networkBuffer.clear();

    const onConsole = (message: ConsoleMessage) => this.recordConsole(toConsoleLevel(message.type()), message.text());
    const onPageError = (error: unknown) =>
      this.recordConsole('error', `Uncaught ${error instanceof Error ? error.message : String(error)}`);
    const onRequest = (request: HTTPRequest) => this.recordRequest(request);
    const onResponse = (response: HTTPResponse) => this.recordResponse(response);
    const onFinished = (request: HTTPRequest) => this.settleRequest(request, null);
    const onFailed = (request: HTTPRequest) => this.settleRequest(request, request.failure()?.errorText ?? 'failed');

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfinished', onFinished);
    page.on('requestfailed', onFailed);
    this.cleanups = [
      () => page.off('console', onConsole),
      () => page.off('pageerror', onPageError),
      () => page.off('request', onRequest),
      () => page.off('response', onResponse),
      () => page.off('requestfinished', onFinished),
      () => page.off('requestfailed', onFailed),
    ];
  }

  detach(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.pending.clear();
  }

  readConsole(options: ConsoleReadOptions): ConsoleEntry[] {
    const entries = filterConsoleEntries(this.consoleBuffer.toArray(), options);
    if (options.clear) this.consoleBuffer.clear();
    return entries;
  }

  readNetwork(options: NetworkReadOptions): NetworkEntry[] {
    const entries = filterNetworkEntries(this.networkBuffer.toArray(), options);
    if (options.clear) this.networkBuffer.clear();
    return entries.map(entry => ({ ...entry }));
  }

  private recordConsole(level: ConsoleLevel, text: string): void {
    this.consoleBuffer.push({ level, text: truncateText(text), timestamp: Date.now() });
  }

  private recordRequest(request: HTTPRequest): void {
    const entry: NetworkEntry = {
      method: request.method(),
      url: redactUrl(request.url()),
      resourceType: request.resourceType(),
      status: null,
      mimeType: null,
      failure: null,
      durationMs: null,
      startedAt: Date.now(),
    };
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      const oldest = this.pending.keys().next().value;
      if (oldest) this.pending.delete(oldest);
    }
    this.pending.set(request, entry);
    this.networkBuffer.push(entry);
  }

  private recordResponse(response: HTTPResponse): void {
    const entry = this.pending.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    entry.mimeType = mimeTypeOf(response.headers()['content-type']);
  }

  private settleRequest(request: HTTPRequest, failure: string | null): void {
    const entry = this.pending.get(request);
    if (!entry) return;
    this.pending.delete(request);
    entry.durationMs = Date.now() - entry.startedAt;
    entry.failure = failure;
  }
}
