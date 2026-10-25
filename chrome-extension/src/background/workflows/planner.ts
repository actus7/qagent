import type { Workflow, WorkflowStep, WorkflowTarget } from '@extension/storage';
import { renderStep, variableNamesOf } from './templating';

/** One call to an existing agent action, with the input that action's schema expects. */
export interface PlannedCall {
  action: 'go_to_url' | 'click' | 'fill' | 'press';
  input: Record<string, unknown>;
  label: string;
}

export type WorkflowPlan = { ok: true; calls: PlannedCall[] } | { ok: false; error: string };

const compactTarget = (target: WorkflowTarget): WorkflowTarget =>
  Object.fromEntries(Object.entries(target).filter(([, value]) => value !== undefined && value !== '')) as WorkflowTarget;

/** A select is replayed as two clicks: open the field, then pick the option by its text. Works for custom dropdowns. */
function callsFor(step: WorkflowStep): PlannedCall[] {
  switch (step.kind) {
    case 'navigate':
      return [{ action: 'go_to_url', input: { url: step.url }, label: `open ${step.url}` }];
    case 'click':
      return [{ action: 'click', input: { target: compactTarget(step.target) }, label: 'click' }];
    case 'fill':
      return [{ action: 'fill', input: { target: compactTarget(step.target), text: step.value }, label: 'fill' }];
    case 'select':
      return [
        { action: 'click', input: { target: compactTarget(step.target) }, label: 'open dropdown' },
        { action: 'click', input: { target: { text: step.value, role: 'option' } }, label: `choose ${step.value}` },
      ];
    case 'press':
      return [{ action: 'press', input: { key: step.key }, label: `press ${step.key}` }];
  }
}

/**
 * Plans a replay: checks every variable has a value, renders the placeholders and maps each step to agent actions.
 * Pure, so the mapping and the missing-variable check are tested without a browser.
 */
export function planWorkflowReplay(workflow: Pick<Workflow, 'steps'>, values: Record<string, string>): WorkflowPlan {
  const missing = variableNamesOf(workflow.steps).filter(name => typeof values[name] !== 'string');
  if (missing.length > 0) return { ok: false, error: `Missing workflow variables: ${missing.join(', ')}` };
  const calls = workflow.steps.flatMap(step => callsFor(renderStep(step, values)));
  return { ok: true, calls };
}
