/* eslint-disable @typescript-eslint/no-unused-vars */
import type { SystemModelMessage, UserModelMessage } from 'ai';
import { BasePrompt } from './base';
import { systemMessage, userMessage } from '../messages/model-messages';
import type { AgentContext } from '@src/background/agent/types';
import { plannerSystemPromptTemplate } from './templates/planner';

export class PlannerPrompt extends BasePrompt {
  getSystemMessage(): SystemModelMessage {
    return systemMessage(plannerSystemPromptTemplate);
  }

  async getUserMessage(context: AgentContext): Promise<UserModelMessage> {
    return userMessage('');
  }
}
