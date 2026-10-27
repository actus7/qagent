import { MAX_RECORDED_STEPS, type RecordedStep } from '@extension/shared';
import type { WorkflowStep, WorkflowTarget } from '@extension/storage';

// Recorded typed values for password, card and similar fields are already redacted by the content script.
// They become a named variable, so the value is supplied at replay time and is never stored.
const SECRET_VARIABLE_PREFIX = 'secret_';

type RecordedElement = { selector: string; name: string; role: string };

const targetOf = ({ selector, name, role }: RecordedElement): WorkflowTarget =>
  name ? { selector, text: name, role } : { selector, role };

const sameTarget = (a: WorkflowTarget, b: WorkflowTarget): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Maps one recorded step to a replayable step. Submits become an Enter press; redacted values become variables. */
function toWorkflowStep(step: RecordedStep, nextSecret: () => number): WorkflowStep {
  switch (step.kind) {
    case 'navigate':
      return { kind: 'navigate', url: step.url };
    case 'click':
      return { kind: 'click', target: targetOf(step.element) };
    case 'type': {
      const value = step.redacted ? `{{${SECRET_VARIABLE_PREFIX}${nextSecret()}}}` : step.value;
      return { kind: 'fill', target: targetOf(step.field), value };
    }
    case 'select':
      return { kind: 'select', target: targetOf(step.field), value: step.value };
    case 'press':
      return { kind: 'press', key: step.key };
    case 'submit':
      return { kind: 'press', key: 'Enter' };
  }
}

/**
 * Removes repeats the recording produces by itself:
 * - a click identical to the one before it,
 * - a fill on the same field as the one before it (the last value wins),
 * - a navigate that follows a click or key press, because the click already caused it,
 * - a navigate to the URL the previous navigate reached.
 */
function dropRepeats(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.reduce<WorkflowStep[]>((kept, step) => {
    const previous = kept.at(-1);
    if (!previous) return [step];
    if (step.kind === 'click' && previous.kind === 'click' && sameTarget(step.target, previous.target)) return kept;
    if (step.kind === 'fill' && previous.kind === 'fill' && sameTarget(step.target, previous.target)) {
      return [...kept.slice(0, -1), step];
    }
    if (step.kind === 'navigate' && (previous.kind === 'click' || previous.kind === 'press')) return kept;
    if (step.kind === 'navigate' && previous.kind === 'navigate' && previous.url === step.url) return kept;
    return [...kept, step];
  }, []);
}

/** Turns recorded steps into a deduplicated, replayable step list. Pure: the same input gives the same output. */
export function normalizeRecording(steps: RecordedStep[]): WorkflowStep[] {
  let secrets = 0;
  const nextSecret = () => {
    secrets += 1;
    return secrets;
  };
  const converted = steps.slice(0, MAX_RECORDED_STEPS).map(step => toWorkflowStep(step, nextSecret));
  return dropRepeats(converted);
}
