// Captcha flow: tick the checkbox with a trusted click, then answer image rounds with the vision model.
// The loop is written against a driver, so it runs in tests without a browser or a model.

export const MAX_CAPTCHA_ROUNDS = 10;
const SETTLE_POLL_MS = 500;
const SETTLE_TIMEOUT_MS = 5000;
const POST_SUBMIT_MS = 1500;

export interface ChallengeTile {
  label: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChallengeView {
  /** Base64 PNG of the challenge frame with each tile numbered. */
  image: string;
  instruction: string;
  tiles: ChallengeTile[];
}

export interface CaptchaWidgetView {
  frameIndex: number;
  vendor: string;
  checkbox: boolean;
  checked: boolean;
  challengeOpen: boolean;
}

export interface CaptchaDriver {
  widgets(): Promise<CaptchaWidgetView[]>;
  solved(): Promise<boolean>;
  clickCheckbox(frameIndex: number): Promise<void>;
  challenge(): Promise<ChallengeView | null>;
  /** Clicks the tiles with these 1-based labels, then presses verify. */
  submitTiles(labels: number[]): Promise<void>;
}

/** Answers one challenge with the tile labels to select. Returns the model's raw text. */
export type TileAnswerer = (challenge: ChallengeView) => Promise<string>;

export interface SolveOptions {
  maxRounds: number;
  pollMs: number;
  timeoutMs: number;
  postSubmitMs: number;
}

export const DEFAULT_SOLVE_OPTIONS: SolveOptions = {
  maxRounds: MAX_CAPTCHA_ROUNDS,
  pollMs: SETTLE_POLL_MS,
  timeoutMs: SETTLE_TIMEOUT_MS,
  postSubmitMs: POST_SUBMIT_MS,
};

export type CaptchaStatus = 'solved' | 'no_widget' | 'unsupported' | 'unsolved';

export interface CaptchaOutcome {
  status: CaptchaStatus;
  rounds: number;
  note: string;
}

/** Reads the labels from a model reply. Only labels that exist on the challenge count; duplicates are dropped. */
export function parseTileAnswer(text: string, tiles: ChallengeTile[]): number[] {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const raw = (parsed as { tiles?: unknown } | null)?.tiles;
  if (!Array.isArray(raw)) return [];
  const valid = new Set(tiles.map(tile => tile.label));
  const labels = raw.filter((value): value is number => typeof value === 'number' && valid.has(value));
  return [...new Set(labels)].sort((a, b) => a - b);
}

async function waitFor<T>(check: () => Promise<T | null>, options: SolveOptions): Promise<T | null> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== null) return value;
    if (Date.now() - started >= options.timeoutMs) return null;
    await new Promise(resolve => setTimeout(resolve, options.pollMs));
  }
}

const solvedOutcome = (rounds: number): CaptchaOutcome => ({ status: 'solved', rounds, note: 'Captcha solved' });

/**
 * Ticks the checkbox, then answers image rounds until the widget reports a token or the rounds run out.
 * A widget without tiles (a checkbox-only challenge, or an unknown layout) is reported as unsupported.
 */
export async function solveCaptcha(
  driver: CaptchaDriver,
  answer: TileAnswerer,
  options: SolveOptions = DEFAULT_SOLVE_OPTIONS,
): Promise<CaptchaOutcome> {
  const widgets = await driver.widgets();
  if (widgets.length === 0) return { status: 'no_widget', rounds: 0, note: 'No captcha widget was found on the page' };
  if (await driver.solved()) return solvedOutcome(0);

  const pending = widgets.find(widget => widget.checkbox && !widget.checked);
  if (pending) await driver.clickCheckbox(pending.frameIndex);

  let rounds = 0;
  for (;;) {
    // Polls the cheap flags only; the challenge screenshot is taken once, after the flags say it is open.
    const next = await waitFor(async () => {
      if (await driver.solved()) return 'solved' as const;
      const open = (await driver.widgets()).some(widget => widget.challengeOpen);
      return open ? ('challenge' as const) : null;
    }, options);
    if (next === 'solved') return solvedOutcome(rounds);
    if (next === null) {
      return { status: 'unsolved', rounds, note: 'No challenge appeared after the checkbox was clicked' };
    }
    const challenge = await driver.challenge();
    if (!challenge) continue;
    if (challenge.tiles.length === 0) {
      return { status: 'unsupported', rounds, note: 'The challenge is not an image grid this tool can answer' };
    }
    if (rounds >= options.maxRounds) break;
    rounds += 1;
    const labels = parseTileAnswer(await answer(challenge), challenge.tiles);
    await driver.submitTiles(labels);
    await new Promise(resolve => setTimeout(resolve, options.postSubmitMs));
  }
  return { status: 'unsolved', rounds, note: `Not solved after ${options.maxRounds} rounds` };
}

/** Draws the tile numbers onto the challenge image so the model can answer by number. */
export async function annotateChallenge(base64Png: string, tiles: ChallengeTile[]): Promise<string> {
  const bytes = Uint8Array.from(atob(base64Png), char => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available for the captcha image');
  context.drawImage(bitmap, 0, 0);
  context.font = 'bold 16px sans-serif';
  for (const tile of tiles) {
    context.fillStyle = 'rgba(255, 0, 0, 0.85)';
    context.fillRect(tile.x, tile.y, 24, 20);
    context.fillStyle = '#fff';
    context.fillText(String(tile.label), tile.x + 5, tile.y + 16);
  }
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const out = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(binary);
}
