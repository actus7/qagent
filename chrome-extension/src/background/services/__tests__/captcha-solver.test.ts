import { describe, expect, it } from 'vitest';
import {
  parseTileAnswer,
  solveCaptcha,
  type CaptchaDriver,
  type CaptchaWidgetView,
  type ChallengeView,
} from '../captcha-solver';

const TILES = [1, 2, 3, 4].map(label => ({ label, x: 0, y: 0, width: 10, height: 10 }));
const CHALLENGE: ChallengeView = { image: 'AAAA', instruction: 'Select the bicycles', tiles: TILES };
// No waiting in tests: the solver polls and settles with these timings.
const FAST = { maxRounds: 10, pollMs: 0, timeoutMs: 0, postSubmitMs: 0 };

function widget(overrides: Partial<CaptchaWidgetView> = {}): CaptchaWidgetView {
  return { frameIndex: 1, vendor: 'recaptcha', checkbox: true, checked: false, challengeOpen: false, ...overrides };
}

/** A driver whose challenge stays open for `rounds` submissions, then the widget reports solved. */
function scriptedDriver(rounds: number, options: { tokenAfter?: boolean } = {}) {
  const log = { clicks: 0, submissions: [] as number[][] };
  let remaining = rounds;
  let solved = false;
  const driver: CaptchaDriver = {
    widgets: async () => [widget({ challengeOpen: remaining > 0 && log.clicks > 0, checked: solved })],
    solved: async () => solved,
    clickCheckbox: async () => {
      log.clicks += 1;
      if (rounds === 0) solved = true;
    },
    challenge: async () => (remaining > 0 && log.clicks > 0 ? CHALLENGE : null),
    submitTiles: async labels => {
      log.submissions.push(labels);
      remaining -= 1;
      if (remaining === 0 && options.tokenAfter !== false) solved = true;
    },
  };
  return { driver, log };
}

describe('parseTileAnswer', () => {
  it('reads the labels from a JSON reply', () => {
    expect(parseTileAnswer('{"tiles":[2,4]}', TILES)).toEqual([2, 4]);
  });

  it('finds the JSON inside surrounding prose', () => {
    expect(parseTileAnswer('Answer: {"tiles": [3]} done', TILES)).toEqual([3]);
  });

  it('drops labels that are not on the challenge, and duplicates', () => {
    expect(parseTileAnswer('{"tiles":[1,1,9,"2"]}', TILES)).toEqual([1]);
  });

  it('returns nothing for a reply that is not JSON', () => {
    expect(parseTileAnswer('I think tiles 1 and 2', TILES)).toEqual([]);
    expect(parseTileAnswer('{"tiles": ', TILES)).toEqual([]);
  });
});

describe('solveCaptcha', () => {
  it('reports no_widget when the page has no captcha', async () => {
    const { driver } = scriptedDriver(0);
    driver.widgets = async () => [];
    const outcome = await solveCaptcha(driver, async () => '{"tiles":[1]}', FAST);
    expect(outcome.status).toBe('no_widget');
  });

  it('is solved after a checkbox click, without any image round', async () => {
    const { driver, log } = scriptedDriver(0);
    const outcome = await solveCaptcha(driver, async () => '{"tiles":[1]}', FAST);
    expect(outcome).toMatchObject({ status: 'solved', rounds: 0 });
    expect(log.submissions).toEqual([]);
  });

  it('answers image rounds until the widget reports solved', async () => {
    const { driver, log } = scriptedDriver(2);
    const answers: string[] = [];
    const outcome = await solveCaptcha(
      driver,
      async challenge => {
        answers.push(challenge.instruction);
        return '{"tiles":[1,3]}';
      },
      FAST,
    );
    expect(outcome).toMatchObject({ status: 'solved', rounds: 2 });
    expect(log.submissions).toEqual([
      [1, 3],
      [1, 3],
    ]);
    expect(answers).toHaveLength(2);
  });

  it('stops after the round limit and reports unsolved', async () => {
    const { driver } = scriptedDriver(50);
    const outcome = await solveCaptcha(driver, async () => '{"tiles":[2]}', { ...FAST, maxRounds: 3 });
    expect(outcome.status).toBe('unsolved');
    expect(outcome.rounds).toBe(3);
  });

  it('reports unsupported when the challenge has no tile grid', async () => {
    const { driver } = scriptedDriver(1);
    driver.challenge = async () => ({ ...CHALLENGE, tiles: [] });
    const outcome = await solveCaptcha(driver, async () => '{"tiles":[1]}', FAST);
    expect(outcome.status).toBe('unsupported');
  });

  it('does not answer at all when the checkbox click opens no challenge', async () => {
    const { driver, log } = scriptedDriver(0);
    driver.solved = async () => false;
    driver.widgets = async () => [widget({ challengeOpen: false, checked: false })];
    const outcome = await solveCaptcha(driver, async () => '{"tiles":[1]}', FAST);
    expect(outcome.status).toBe('unsolved');
    expect(log.submissions).toEqual([]);
  });
});
