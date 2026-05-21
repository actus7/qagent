import type { Logger } from '@src/background/log';

const ONE_MINUTE_MS = 60_000;

interface RateLimitBucket {
  timestamps: number[];
  tail: Promise<void>;
}

const buckets = new Map<string, RateLimitBucket>();

function getBucket(key: string): RateLimitBucket {
  const existing = buckets.get(key);
  if (existing) {
    return existing;
  }
  const bucket: RateLimitBucket = {
    timestamps: [],
    tail: Promise.resolve(),
  };
  buckets.set(key, bucket);
  return bucket;
}

function pruneOldTimestamps(bucket: RateLimitBucket, now: number): void {
  while (bucket.timestamps.length > 0 && now - bucket.timestamps[0] >= ONE_MINUTE_MS) {
    bucket.timestamps.shift();
  }
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface AcquireRateLimitSlotArgs {
  key: string;
  requestsPerMinute: number;
  signal?: AbortSignal;
  logger?: Logger;
  operationLabel?: string;
}

export async function acquireRateLimitSlot(args: AcquireRateLimitSlotArgs): Promise<void> {
  const normalizedLimit = Math.max(1, Math.floor(args.requestsPerMinute));
  const key = args.key.trim();
  if (!key) {
    return;
  }

  const bucket = getBucket(key);
  const task = bucket.tail.then(async () => {
    let hasSlot = false;
    while (!hasSlot) {
      if (args.signal?.aborted) {
        throw args.signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      const now = Date.now();
      pruneOldTimestamps(bucket, now);

      if (bucket.timestamps.length < normalizedLimit) {
        bucket.timestamps.push(now);
        hasSlot = true;
        return;
      }

      const oldestTimestamp = bucket.timestamps[0];
      const waitMs = Math.max(100, ONE_MINUTE_MS - (now - oldestTimestamp) + 25);
      args.logger?.info(
        `Rate limit wait (${normalizedLimit} rpm) for ${args.operationLabel ?? 'request'}: ${waitMs}ms`,
      );
      await sleepWithAbort(waitMs, args.signal);
    }
  });

  bucket.tail = task.then(
    () => undefined,
    () => undefined,
  );

  await task;
}

export function __resetRateLimiterForTests(): void {
  buckets.clear();
}
