import type { WorkflowStep, WorkflowTarget } from '@extension/storage';

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** Names of the {{variables}} used in one text. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map(match => match[1]);
}

const textsOfTarget = (target: WorkflowTarget): string[] =>
  [target.selector, target.text, target.role].filter((value): value is string => typeof value === 'string');

/** Every text a step carries, so placeholders can be found and rendered in one place. */
function textsOfStep(step: WorkflowStep): string[] {
  switch (step.kind) {
    case 'navigate':
      return [step.url];
    case 'click':
      return textsOfTarget(step.target);
    case 'fill':
    case 'select':
      return [...textsOfTarget(step.target), step.value];
    case 'press':
      return [step.key];
  }
}

/** Sorted, unique variable names used anywhere in the steps. */
export function variableNamesOf(steps: WorkflowStep[]): string[] {
  const names = steps.flatMap(step => textsOfStep(step).flatMap(placeholdersIn));
  return [...new Set(names)].sort();
}

/** Replaces each {{name}} with its value. Placeholders without a value stay in place; the planner rejects them. */
export function renderText(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => (name in values ? values[name] : whole));
}

const renderTarget = (target: WorkflowTarget, values: Record<string, string>): WorkflowTarget =>
  Object.fromEntries(
    Object.entries(target).map(([key, value]) => [key, renderText(value ?? '', values)]),
  ) as WorkflowTarget;

/** A step with its placeholders filled in. The input step is not changed. */
export function renderStep(step: WorkflowStep, values: Record<string, string>): WorkflowStep {
  switch (step.kind) {
    case 'navigate':
      return { kind: 'navigate', url: renderText(step.url, values) };
    case 'click':
      return { kind: 'click', target: renderTarget(step.target, values) };
    case 'fill':
      return { kind: 'fill', target: renderTarget(step.target, values), value: renderText(step.value, values) };
    case 'select':
      return { kind: 'select', target: renderTarget(step.target, values), value: renderText(step.value, values) };
    case 'press':
      return { kind: 'press', key: step.key };
  }
}
