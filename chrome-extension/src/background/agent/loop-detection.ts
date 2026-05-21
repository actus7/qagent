import type { AgentStepRecord } from './history';

const LOOP_PRONE_ACTIONS = new Set([
  'search_google',
  'go_to_url',
  'go_back',
  'open',
  'back',
  'forward',
  'reload',
  'wait',
]);
const MAX_NAVIGATION_ONLY_STEPS = 6;
const MAX_REPEATED_SIGNATURES = 3;
const SIGNATURE_HISTORY_LIMIT = 6;

export interface LoopDetectionState {
  navigationOnlyStreak: number;
  signatures: string[];
}

export interface LoopDetectionResult {
  nextState: LoopDetectionState;
  loopDetected: boolean;
}

interface ParsedAction {
  name: string;
  args: unknown;
}

export function createLoopDetectionState(): LoopDetectionState {
  return {
    navigationOnlyStreak: 0,
    signatures: [],
  };
}

export function evaluateLoopDetection(
  currentState: LoopDetectionState,
  stepRecord: AgentStepRecord | undefined,
  done: boolean,
): LoopDetectionResult {
  if (done || !stepRecord?.modelOutput) {
    return {
      nextState: createLoopDetectionState(),
      loopDetected: false,
    };
  }

  const parsedActions = parseActions(stepRecord.modelOutput);
  if (parsedActions.length === 0 || parsedActions.some(action => !LOOP_PRONE_ACTIONS.has(action.name))) {
    return {
      nextState: createLoopDetectionState(),
      loopDetected: false,
    };
  }

  const signature = buildStepSignature(stepRecord, parsedActions);
  const signatures = [...currentState.signatures, signature].slice(-SIGNATURE_HISTORY_LIMIT);
  const navigationOnlyStreak = currentState.navigationOnlyStreak + 1;

  const repeatedPatternDetected =
    signatures.length >= MAX_REPEATED_SIGNATURES &&
    signatures.slice(-MAX_REPEATED_SIGNATURES).every(value => value === signatures[signatures.length - 1]);

  const loopDetected = repeatedPatternDetected || navigationOnlyStreak >= MAX_NAVIGATION_ONLY_STEPS;

  return {
    nextState: {
      navigationOnlyStreak,
      signatures,
    },
    loopDetected,
  };
}

function parseActions(modelOutput: string): ParsedAction[] {
  try {
    const parsedOutput = JSON.parse(modelOutput) as {
      action?: Array<Record<string, unknown> | null>;
    };

    if (!Array.isArray(parsedOutput.action)) {
      return [];
    }

    return parsedOutput.action
      .filter((action): action is Record<string, unknown> => Boolean(action))
      .map(action => {
        const actionName = Object.keys(action)[0];
        if (!actionName) {
          return null;
        }
        return {
          name: actionName,
          args: action[actionName],
        };
      })
      .filter((action): action is ParsedAction => Boolean(action?.name));
  } catch {
    return [];
  }
}

function buildStepSignature(stepRecord: AgentStepRecord, actions: ParsedAction[]): string {
  const normalizedUrl = normalizeText(stepRecord.state.url);
  const actionSignature = actions
    .map(action => `${action.name}:${normalizeActionArgs(action.name, action.args)}`)
    .join('|');
  return `${normalizedUrl}::${actionSignature}`;
}

function normalizeActionArgs(actionName: string, rawArgs: unknown): string {
  if (!rawArgs || typeof rawArgs !== 'object') {
    return '';
  }

  const args = rawArgs as Record<string, unknown>;

  if (actionName === 'search_google') {
    return normalizeText(args.query);
  }

  if (actionName === 'go_to_url') {
    return normalizeText(args.url);
  }

  if (actionName === 'open') {
    return normalizeText(args.url);
  }

  if (actionName === 'wait') {
    return String(args.seconds ?? '');
  }

  return '';
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}
