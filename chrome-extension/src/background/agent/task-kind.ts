/**
 * Classifies a user task from its text. Heuristics on purpose: a miss only costs speed
 * (an extra planner call) or report length, never correctness.
 */

export type ReportStyle = 'qa' | 'concise';

// URLs are stripped first so hosts and paths (e.g. "teste.example.com") do not change the classification.
const URL_PATTERN = /https?:\/\/\S+/gi;
// ponytail: keyword list, not a model call; extend when a QA request is missed
const QA_TASK_PATTERN =
  /\b(?:testar|teste|testes|testando|test|tests|testing|qa|valide|validar|valida|verifique|verificar|verifica|audite|auditar|audita|relat[oó]rios?|report|reports)\b/i;
// Single-goal imperative verbs (pt-BR and en). Matched with a lookahead because "vá" ends in a non-ASCII letter.
const SIMPLE_TASK_VERB =
  /^(?:abra|abrir|abre|acesse|acessar|navegue|navegar|visite|visitar|clique|clicar|vá|ir|open|go|navigate|visit|click)(?=\s|$)/i;
// Connectors, list markers and sequencing words mean more than one goal.
const MULTI_STEP_PATTERN = /[;\n]|\d[.)]\s|(?:^|\s)[-*•]\s|\b(?:e|depois|então|em seguida|and|then|after|also|next)\b/i;
const MAX_SIMPLE_TASK_LENGTH = 200;

function stripUrls(task: string): string {
  return task.replace(URL_PATTERN, ' ').trim();
}

/** A QA, test, verification or report request: the navigator writes the full structured QA report. */
export function isQaTask(task: string): boolean {
  return QA_TASK_PATTERN.test(stripUrls(task));
}

/** A short, single-goal request ("abra X", "clique em Y", "open the pricing page") that is not a QA request. */
export function isSimpleTask(task: string): boolean {
  const goal = stripUrls(task);
  return (
    goal.length > 0 &&
    goal.length <= MAX_SIMPLE_TASK_LENGTH &&
    SIMPLE_TASK_VERB.test(goal) &&
    !MULTI_STEP_PATTERN.test(goal) &&
    !QA_TASK_PATTERN.test(goal)
  );
}

export function reportStyleFor(task: string): ReportStyle {
  return isQaTask(task) ? 'qa' : 'concise';
}
