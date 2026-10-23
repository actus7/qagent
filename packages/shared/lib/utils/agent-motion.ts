// Pure motion math for the agent cursor. Shared so the content overlay and its unit tests use one implementation.

export interface AgentPoint {
  x: number;
  y: number;
}

export const GLIDE_MIN_MS = 300;
export const GLIDE_MAX_MS = 450;
const GLIDE_MS_PER_PX = 0.25;
// The arc bows sideways by at most this much, so long moves curve gently and short ones stay almost straight.
const BOW_RATIO = 0.12;
const BOW_MAX_PX = 80;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function easeInOutCubic(progress: number): number {
  const t = clamp01(progress);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function glideDurationMs(from: AgentPoint, to: AgentPoint): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, GLIDE_MIN_MS + distance * GLIDE_MS_PER_PX));
}

/** Point on a quadratic Bezier from `from` to `to`; `progress` is already eased and clamped to [0, 1]. */
export function curvedPathPoint(from: AgentPoint, to: AgentPoint, progress: number): AgentPoint {
  const t = clamp01(progress);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: from.x, y: from.y };

  const bow = Math.min(distance * BOW_RATIO, BOW_MAX_PX);
  // Control point: the midpoint pushed along the unit normal (-dy, dx).
  const controlX = (from.x + to.x) / 2 + (-dy / distance) * bow;
  const controlY = (from.y + to.y) / 2 + (dx / distance) * bow;
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * controlX + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * controlY + t * t * to.y,
  };
}

/** Cursor position `elapsedMs` into a glide of `durationMs`, with easing applied along the curved path. */
export function glideFrame(
  from: AgentPoint,
  to: AgentPoint,
  elapsedMs: number,
  durationMs: number,
): { point: AgentPoint; done: boolean } {
  const progress = durationMs <= 0 ? 1 : clamp01(elapsedMs / durationMs);
  return { point: curvedPathPoint(from, to, easeInOutCubic(progress)), done: progress >= 1 };
}
