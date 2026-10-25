import { generateText } from 'ai';
import type { AssistantTaskOptions, RecordedStep } from '@extension/shared';
import { workflowsStore, type Workflow, type WorkflowStep } from '@extension/storage';
import { createLogger } from '../log';
import { loadAssistantModel } from '../services/assistant-model';
import { normalizeRecording } from './normalize';
import { extractJsonObject, parseWorkflowDraft, toWorkflow, type WorkflowDraft } from './draft';

const logger = createLogger('WorkflowBuilder');
const LLM_TIMEOUT_MS = 60_000;

const BUILD_PROMPT = [
  'You turn a recorded browser procedure into a reusable workflow.',
  'Reply with one JSON object only: {"name": string, "description": string, "variables": [{"name": string, "description": string}], "steps": [...]}.',
  'Step kinds: {"kind":"navigate","url"}, {"kind":"click","target"}, {"kind":"fill","target","value"}, {"kind":"select","target","value"}, {"kind":"press","key"}.',
  'target is {"selector","text","role"}; copy the selectors and names from the recording and do not invent new ones.',
  'Replace values that the user would change each time (names, emails, search terms, quantities) with {{variable_name}} placeholders, snake_case.',
  'Keep the order of the recording. Never invent values for password, card or secret fields; keep their {{secret_N}} placeholders.',
].join('\n');

/** Asks the configured navigator model to generalise the recorded steps. Null when the model is unavailable or its reply is invalid. */
async function draftWithModel(
  name: string,
  steps: WorkflowStep[],
  modelAgent: AssistantTaskOptions['modelAgent'],
): Promise<WorkflowDraft | null> {
  try {
    const model = await loadAssistantModel(modelAgent);
    const reply = await generateText({
      model: model.model,
      ...model.settings,
      instructions: BUILD_PROMPT,
      prompt: `Workflow name: ${name}\nRecorded steps (JSON):\n${JSON.stringify(steps)}`,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      maxRetries: 0,
    });
    return parseWorkflowDraft(extractJsonObject(reply.text));
  } catch (error) {
    logger.error('Workflow drafting failed; saving the recorded steps as they are', error);
    return null;
  }
}

/** Fallback draft: the recorded steps as they are, with the secret placeholders already in place. */
function fallbackDraft(name: string, steps: WorkflowStep[]): WorkflowDraft {
  return { name, description: '', variables: [], steps };
}

/**
 * Builds a workflow from recorded steps and saves it. The model only generalises the steps; if it fails the
 * deterministic steps are saved, so a recording is never lost to a model error.
 */
export async function saveRecordedWorkflow(
  name: string,
  recorded: RecordedStep[],
  modelAgent: AssistantTaskOptions['modelAgent'],
): Promise<Workflow> {
  const steps = normalizeRecording(recorded);
  if (steps.length === 0) throw new Error('The recording has no steps to save.');
  const draft = (await draftWithModel(name, steps, modelAgent)) ?? fallbackDraft(name, steps);
  const id = crypto.randomUUID();
  const workflow = toWorkflow({ ...draft, name }, id, Date.now());
  await workflowsStore.save(workflow);
  return workflow;
}
