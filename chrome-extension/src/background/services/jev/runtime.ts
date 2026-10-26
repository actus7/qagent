import { askSystemOne, type JevAnswer, type JevChoiceAnswer, type JevQuestion } from '@extension/shared';
import type { JevConfig, JevFeature } from '@extension/storage';
import { createLogger } from '@src/background/log';
import type { JevTaskMetrics } from './metrics';

const logger = createLogger('Jev');
// ponytail: one short timeout for every Jev question; a slow Jev call must never cost more than the LLM it replaces
const JEV_TIMEOUT_MS = 3000;

export interface JevRuntime {
  config: JevConfig;
  metrics: JevTaskMetrics;
  /** The task the questions are about (the current one, for follow-up tasks). */
  task: string;
}

export type JevAnswers = Record<string, JevAnswer>;

export function isJevFeatureOn(runtime: JevRuntime | null | undefined, feature: JevFeature): boolean {
  return Boolean(runtime?.config.features[feature]);
}

export function readNoul(answers: JevAnswers, id: string): number | null {
  const answer = answers[id];
  return answer?.type === 'noul' && Number.isFinite(answer.noul) ? answer.noul : null;
}

export function readChoice(answers: JevAnswers, id: string): JevChoiceAnswer | null {
  const answer = answers[id];
  return answer?.type === 'choice' && typeof answer.choice === 'string' ? answer : null;
}

/**
 * Asks Jev the questions of one feature and lets the feature's pure decision turn the answers into an action.
 * Returns null, and records a fallback with the reason in the log, when the feature is off, Jev is not configured,
 * the call fails or times out, or the decision is not confident. Callers then keep the LLM path.
 */
export async function decideWithJev<T>(
  runtime: JevRuntime | null | undefined,
  feature: JevFeature,
  request: { state: unknown; questions: Record<string, JevQuestion> },
  decide: (answers: JevAnswers, threshold: number) => T | null,
  signal?: AbortSignal,
): Promise<T | null> {
  if (!runtime || !runtime.config.features[feature]) return null;
  const { apiKey, model, thresholds } = runtime.config;
  if (!apiKey) {
    runtime.metrics.recordFallback(feature);
    logger.warning(`Jev ${feature} is on but no API key is configured; using the LLM`);
    return null;
  }

  runtime.metrics.recordJevCall();
  try {
    const answers = await askSystemOne({ apiKey, model }, request.state, request.questions, {
      signal,
      timeoutMs: JEV_TIMEOUT_MS,
    });
    const decision = decide(answers, thresholds[feature]);
    if (decision === null) {
      runtime.metrics.recordFallback(feature);
      logger.info(`Jev ${feature}: not confident enough (threshold ${thresholds[feature]}); using the LLM`);
      return null;
    }
    runtime.metrics.recordHit(feature);
    logger.info(`Jev ${feature}: decided without the LLM`);
    return decision;
  } catch (error) {
    runtime.metrics.recordFallback(feature);
    logger.warning(`Jev ${feature} failed; using the LLM`, error);
    return null;
  }
}
