import { z } from 'zod';
import { MAX_RECORDED_STEPS } from '@extension/shared';
import type { Workflow, WorkflowStep, WorkflowVariable } from '@extension/storage';
import { variableNamesOf } from './templating';

const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_TEXT_CHARS = 2000;
const MAX_NAME_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 300;
const MAX_VARIABLES = 20;

const targetSchema = z.object({
  selector: z.string().max(500).optional(),
  text: z.string().max(200).optional(),
  role: z.string().max(40).optional(),
});

const stepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().max(MAX_TEXT_CHARS) }),
  z.object({ kind: z.literal('click'), target: targetSchema }),
  z.object({ kind: z.literal('fill'), target: targetSchema, value: z.string().max(MAX_TEXT_CHARS) }),
  z.object({ kind: z.literal('select'), target: targetSchema, value: z.string().max(MAX_TEXT_CHARS) }),
  z.object({ kind: z.literal('press'), key: z.string().max(40) }),
]);

const draftSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS).default(''),
  variables: z
    .array(
      z.object({
        name: z.string().regex(VARIABLE_NAME_PATTERN).max(40),
        description: z.string().max(MAX_DESCRIPTION_CHARS).default(''),
      }),
    )
    .max(MAX_VARIABLES)
    .default([]),
  steps: z.array(stepSchema).min(1).max(MAX_RECORDED_STEPS),
});

export interface WorkflowDraft {
  name: string;
  description: string;
  variables: WorkflowVariable[];
  steps: WorkflowStep[];
}

/** Validates the model's JSON reply. Throws a ZodError on the first mismatch. */
export function parseWorkflowDraft(raw: unknown): WorkflowDraft {
  return draftSchema.parse(raw);
}

/** Pulls the JSON object out of a model reply that may wrap it in prose or a code fence. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model reply has no JSON object.');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Every {{placeholder}} the steps use gets a declared variable. Names the model declared keep their descriptions;
 * undeclared ones get a generic description, so replay never meets an unknown variable.
 */
export function withDeclaredVariables(draft: WorkflowDraft): WorkflowVariable[] {
  const declared = new Map(draft.variables.map(variable => [variable.name, variable]));
  for (const name of variableNamesOf(draft.steps)) {
    if (!declared.has(name)) declared.set(name, { name, description: 'Value entered for this step' });
  }
  return [...declared.values()];
}

export function toWorkflow(draft: WorkflowDraft, id: string, now: number): Workflow {
  return {
    id,
    name: draft.name,
    description: draft.description,
    variables: withDeclaredVariables(draft),
    steps: draft.steps,
    createdAt: now,
    updatedAt: now,
  };
}
