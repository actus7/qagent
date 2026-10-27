// Reads a long text one group at a time. A cursor carries the offset and a digest of the text already
// handed out, so a page that changed underneath the reader is reported as stale instead of mixed.

const TEXT_CHUNK_MAX_CHARS = 200_000;

const CURSOR_PATTERN = /^(\d+)\.([0-9a-f]{8})$/;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a, 32 bit, as 8 hex digits. Cheap and stable; it only has to notice edits, not resist attackers. */
export function digestText(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Boundaries in preference order. Each one is only used when its cut lies past `minFraction` of the budget. */
const BOUNDARIES: Array<{ pattern: RegExp; minFraction: number }> = [
  { pattern: /\n\s*\n/g, minFraction: 0.5 },
  { pattern: /[.!?]["')\]]*\s+/g, minFraction: 0.25 },
  { pattern: /\n/g, minFraction: 0.25 },
  { pattern: /\s+/g, minFraction: 0.5 },
];

/** End index (exclusive) of the group that starts at `start` and fits in `budget` characters. */
export function chunkEnd(text: string, start: number, budget: number): number {
  if (text.length - start <= budget) return text.length;
  const window = text.slice(start, start + budget);
  for (const { pattern, minFraction } of BOUNDARIES) {
    const cut = lastBoundaryAfter(window, pattern, Math.floor(budget * minFraction));
    if (cut > 0) return start + cut;
  }
  return start + budget;
}

function lastBoundaryAfter(window: string, pattern: RegExp, minCut: number): number {
  let cut = 0;
  for (const match of window.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end >= minCut) cut = end;
  }
  return cut;
}

export function encodeCursor(offset: number, delivered: string): string {
  return `${offset}.${digestText(delivered)}`;
}

export function decodeCursor(cursor: string): { offset: number; digest: string } | null {
  const match = CURSOR_PATTERN.exec(cursor.trim());
  return match ? { offset: Number(match[1]), digest: match[2] } : null;
}

type ChunkReadResult =
  | { status: 'invalid' }
  | { status: 'stale' }
  | { status: 'ok'; content: string; offset: number; totalLength: number; cursor: string | null };

/**
 * One group of `full`, starting after `cursor` (or at the top). A cursor whose digest no longer matches the
 * text before its offset means the page changed, so the reader must start over.
 */
export function readTextChunk(full: string, options: { maxLength: number; cursor?: string }): ChunkReadResult {
  const resume = options.cursor ? decodeCursor(options.cursor) : null;
  if (options.cursor && !resume) return { status: 'invalid' };
  if (resume && digestText(full.slice(0, resume.offset)) !== resume.digest) return { status: 'stale' };

  const budget = Math.min(options.maxLength, TEXT_CHUNK_MAX_CHARS);
  const offset = resume?.offset ?? 0;
  const end = chunkEnd(full, offset, budget);
  const more = end < full.length;
  return {
    status: 'ok',
    content: full.slice(offset, end).trimEnd(),
    offset,
    totalLength: full.length,
    cursor: more ? encodeCursor(end, full.slice(0, end)) : null,
  };
}
