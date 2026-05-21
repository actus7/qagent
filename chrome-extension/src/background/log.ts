/// <reference types="vite/client" />

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

const REDACTED = '[REDACTED]';
const MAX_REDACTION_DEPTH = 4;
const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|token|secret|password|authorization|cookie|session|private[_-]?key|bearer)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /sk-[a-z0-9_-]{16,}/i,
  /bearer\s+[a-z0-9\-._~+/]+=*/i,
  /AIza[0-9A-Za-z\-_]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warning: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
}

export interface LogEntry {
  namespace: string;
  level: LogLevel;
  args: unknown[];
  timestamp: number;
}

type LogListener = (entry: LogEntry) => void;

let verboseLoggingEnabled = false;
const logListeners = new Set<LogListener>();

function redactString(value: string): string {
  if (SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    return REDACTED;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return Object.prototype.toString.call(value) === '[object Object]';
}

function redactLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_REDACTION_DEPTH) {
    return '[Truncated]';
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(item => redactLogValue(item, depth + 1, seen));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactLogValue(nestedValue, depth + 1, seen);
  }
  return redacted;
}

const sanitizeLogArgs = (args: unknown[]) => args.map(arg => redactLogValue(arg));

const shouldEmitDebugLogs = () => import.meta.env.DEV || verboseLoggingEnabled;

const emitLogEntry = (entry: LogEntry) => {
  for (const listener of logListeners) {
    try {
      listener(entry);
    } catch (error) {
      console.error('[Logger] Failed to notify listener', error);
    }
  }
};

const logAndPublish = (namespace: string, level: LogLevel, sink: (...args: unknown[]) => void, args: unknown[]) => {
  if (level === 'debug' && !shouldEmitDebugLogs()) {
    return;
  }

  const sanitizedArgs = sanitizeLogArgs(args);
  sink(...sanitizedArgs);
  emitLogEntry({
    namespace,
    level,
    args: sanitizedArgs,
    timestamp: Date.now(),
  });
};

const createLogger = (namespace: string): Logger => {
  const prefix = `[${namespace}]`;

  // Bind console methods directly to preserve call stack and show correct line numbers
  const boundDebug = console.debug.bind(console, prefix);
  const boundInfo = console.info.bind(console, prefix);
  const boundWarn = console.warn.bind(console, prefix);
  const boundError = console.error.bind(console, prefix);
  const boundGroup = console.group.bind(console);
  const boundGroupEnd = console.groupEnd.bind(console);

  return {
    debug: (...args: unknown[]) => logAndPublish(namespace, 'debug', boundDebug, args),
    info: (...args: unknown[]) => logAndPublish(namespace, 'info', boundInfo, args),
    warning: (...args: unknown[]) => logAndPublish(namespace, 'warning', boundWarn, args),
    error: (...args: unknown[]) => logAndPublish(namespace, 'error', boundError, args),
    group: (label: string) => boundGroup(`${prefix} ${label}`),
    groupEnd: boundGroupEnd,
  };
};

// Create default logger
const logger = createLogger('Agent');

const setVerboseLoggingEnabled = (enabled: boolean) => {
  verboseLoggingEnabled = enabled;
};

const isVerboseLoggingEnabled = () => verboseLoggingEnabled;

const subscribeLogEntries = (listener: LogListener) => {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
};

export type { Logger, LogLevel };
export { createLogger, logger, redactLogValue, setVerboseLoggingEnabled, isVerboseLoggingEnabled, subscribeLogEntries };
