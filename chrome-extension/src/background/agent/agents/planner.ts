import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import type { AgentOutput } from '../types';
import { userMessage } from '../messages/model-messages';
import { Actors, ExecutionState } from '../event/types';
import { classifyModelError } from './errors';
import { filterExternalContent } from '../messages/utils';
const logger = createLogger('PlannerAgent');

// Define Zod schema for planner output
// ponytail: the text fields are informational; a model that omits one (MiMo does) or answers a "list" field
// with an array must not fail the whole step
const textField = z
  .union([z.string(), z.array(z.unknown()).transform(items => items.map(String).join('\n'))])
  .default('');

export const plannerOutputSchema = z.object({
  observation: textField,
  challenges: textField,
  done: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
  next_steps: textField,
  final_answer: textField,
  reasoning: textField,
  web_task: z
    .union([
      z.boolean(),
      z.string().transform(val => {
        if (val.toLowerCase() === 'true') return true;
        if (val.toLowerCase() === 'false') return false;
        throw new Error('Invalid boolean string');
      }),
    ])
    .default(true),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput> {
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });

    const isGeminiModel = this.modelName.toLowerCase().includes('gemini');
    if (isGeminiModel && this.withStructuredOutput) {
      this.withStructuredOutput = false;
      logger.info(`[${this.modelName}] Planner structured output disabled; using manual JSON extraction mode.`);
    }
  }

  async execute(): Promise<AgentOutput<PlannerOutput>> {
    try {
      await this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...');
      // get all messages from the message manager, state message should be the last one
      const messages = this.context.messageManager.getMessages();
      // Use full message history except the first one
      const plannerMessages = [this.prompt.getSystemMessage(), ...messages.slice(1)];

      // Remove images from last message if vision is not enabled for planner but vision is enabled
      if (!this.context.options.useVisionForPlanner && this.context.options.useVision) {
        const lastStateMessage = plannerMessages[plannerMessages.length - 1];
        // Keep the text parts only; image parts are skipped
        const newMsg = Array.isArray(lastStateMessage.content)
          ? lastStateMessage.content.map(part => (part.type === 'text' ? part.text : '')).join('')
          : lastStateMessage.content;

        plannerMessages[plannerMessages.length - 1] = userMessage(newMsg);
      }

      const modelOutput = await this.invoke(plannerMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate planner output');
      }

      // clean the model output
      const observation = filterExternalContent(modelOutput.observation);
      const final_answer = filterExternalContent(modelOutput.final_answer);
      const next_steps = filterExternalContent(modelOutput.next_steps);
      const challenges = filterExternalContent(modelOutput.challenges);
      const reasoning = filterExternalContent(modelOutput.reasoning);

      const cleanedPlan: PlannerOutput = {
        ...modelOutput,
        observation,
        challenges,
        reasoning,
        final_answer,
        next_steps,
      };

      // If task is done, emit the final answer; otherwise emit next steps
      const eventMessage = cleanedPlan.done ? cleanedPlan.final_answer : cleanedPlan.next_steps;
      await this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, eventMessage);
      logger.info('Planner output', JSON.stringify(cleanedPlan, null, 2));

      return {
        id: this.id,
        result: cleanedPlan,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check if this is an authentication error; a timeout is a plain failure, counted like a navigator timeout
      const modelError = classifyModelError(error);
      if (modelError) throw modelError;

      logger.error(`Planning failed: ${errorMessage}`);
      await this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_FAIL, `Planning failed: ${errorMessage}`);
      return {
        id: this.id,
        error: errorMessage,
      };
    }
  }
}
