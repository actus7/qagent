// Minimal client for TypeSafe System One (Jev): typed judgments with calibrated probabilities, no generated text.
// https://docs.typesafe.ai/api
export const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_TIMEOUT_MS = 4000;

export interface JevCredentials {
  apiKey: string;
  model: string;
}

export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}
export interface JevNoulQuestion {
  type: 'noul';
  instructions: string;
}
export type JevQuestion = JevChoiceQuestion | JevNoulQuestion;

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}
export type JevAnswer = JevChoiceAnswer | JevNoulAnswer;

export async function askSystemOne(
  credentials: JevCredentials,
  state: unknown,
  questions: Record<string, JevQuestion>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Record<string, JevAnswer>> {
  if (!credentials.apiKey) throw new Error('Jev API key is not configured');
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(JEV_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.apiKey}` },
    body: JSON.stringify({ model: credentials.model, state, questions }),
    signal,
  });
  if (!response.ok) throw new Error(`Jev request failed with status ${response.status}`);
  const body = (await response.json()) as { answers?: Record<string, JevAnswer> };
  if (!body.answers || typeof body.answers !== 'object') throw new Error('Jev response has no answers');
  return body.answers;
}
