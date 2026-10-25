import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import { generateText } from 'ai';
import type { z } from 'zod';
import { Actors, ExecutionState } from '../event/types';
import { imagePart } from '../messages/model-messages';
import type { BrowserPageLike } from '../../browser/types';
import { loadAssistantModel } from '../../services/assistant-model';
import { annotateChallenge, solveCaptcha, type CaptchaDriver, type ChallengeView } from '../../services/captcha-solver';
import { Action } from './action';
import { actionFailedResult, engineUnsupportedResult } from './shared';
import { findCaptchaActionSchema, solveCaptchaActionSchema } from './schemas';

const VISION_TIMEOUT_MS = 60000;

function visionPrompt(instruction: string): string {
  const shown = instruction || 'none shown';
  return [
    'You solve an image captcha. The image shows the challenge with numbered tiles.',
    `Instruction on the challenge: ${shown}`,
    'Reply with JSON only, in the form {"tiles":[1,4]}, listing the numbers of the tiles that match the instruction.',
  ].join('\n');
}

/** Asks the navigator's vision model which numbered tiles to select. Returns its raw reply. */
async function answerWithVisionModel(challenge: ChallengeView): Promise<string> {
  const model = await loadAssistantModel('navigator');
  const text = { type: 'text' as const, text: visionPrompt(challenge.instruction) };
  const image = imagePart(`data:image/png;base64,${challenge.image}`);
  const reply = await generateText({
    model: model.model,
    ...model.settings,
    messages: [{ role: 'user', content: image ? [text, image] : [text] }],
    abortSignal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    maxRetries: 0,
  });
  return reply.text;
}

/** Adapts the page's captcha methods to the solver's driver. Each call goes to the live page. */
function pageCaptchaDriver(page: BrowserPageLike): CaptchaDriver {
  return {
    widgets: () => page.captchaWidgets?.() ?? Promise.resolve([]),
    solved: () => page.captchaSolved?.() ?? Promise.resolve(false),
    clickCheckbox: frameIndex => page.clickCaptchaCheckbox?.(frameIndex) ?? Promise.resolve(),
    async challenge() {
      const raw = await page.captchaChallenge?.();
      if (!raw) return null;
      return {
        image: await annotateChallenge(raw.image, raw.tiles),
        instruction: raw.instruction,
        tiles: raw.tiles,
      };
    },
    submitTiles: labels => page.submitCaptchaTiles?.(labels) ?? Promise.resolve(),
  };
}

export function createFindCaptchaAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof findCaptchaActionSchema.schema>) => {
    const intent = input.intent || t('act_captcha_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.captchaWidgets) return engineUnsupportedResult(context);
    try {
      const widgets = await page.captchaWidgets();
      if (widgets.length === 0) {
        const msg = t('act_captcha_none');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }
      const lines = widgets.map(widget => {
        const box = widget.checkbox ? (widget.checked ? 'checked' : 'unchecked') : 'missing';
        const challenge = widget.challengeOpen ? 'open' : 'closed';
        return `- ${widget.vendor} frame ${widget.frameIndex}: checkbox ${box}, challenge ${challenge}`;
      });
      const msg = t('act_captcha_found', [String(widgets.length)]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: `${msg}\n${lines.join('\n')}`, includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, findCaptchaActionSchema);
}

export function createSolveCaptchaAction(context: AgentContext) {
  return new Action(async (input: z.infer<typeof solveCaptchaActionSchema.schema>) => {
    const intent = input.intent || t('act_solveCaptcha_start');
    context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    const page = await context.browserContext.getCurrentPage();
    if (!page.captchaWidgets || !page.captchaSolved) return engineUnsupportedResult(context);
    try {
      const outcome = await solveCaptcha(pageCaptchaDriver(page), answerWithVisionModel);
      const msg = t('act_solveCaptcha_ok', [outcome.status, String(outcome.rounds), outcome.note]);
      if (outcome.status === 'solved') {
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      }
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
      return new ActionResult({ error: msg, includeInMemory: true });
    } catch (error) {
      return actionFailedResult(context, error);
    }
  }, solveCaptchaActionSchema);
}
