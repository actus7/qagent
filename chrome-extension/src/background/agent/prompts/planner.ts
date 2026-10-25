/* eslint-disable @typescript-eslint/no-unused-vars */
import type { SystemModelMessage, UserModelMessage } from 'ai';
import { BasePrompt } from './base';
import { systemMessage, userMessage } from '../messages/model-messages';
import type { AgentContext } from '@src/background/agent/types';
import { plannerSystemPromptTemplate } from './templates/planner';
import type { ReportStyle } from '../task-kind';

const FINAL_ANSWER_RULES: Record<ReportStyle, string> = {
  qa: 'a complete, user-friendly response that directly addresses what the user asked for',
  concise:
    'a short user-friendly response: a few plain lines with the outcome and the key facts the user asked for, no headings or report structure',
};

export class PlannerPrompt extends BasePrompt {
  private readonly systemMessage: SystemModelMessage;

  constructor(reportStyle: ReportStyle = 'qa') {
    super();
    this.systemMessage = systemMessage(
      // The placeholder appears in two places in the template
      plannerSystemPromptTemplate.split('{{final_answer_rule}}').join(FINAL_ANSWER_RULES[reportStyle]),
    );
  }

  getSystemMessage(): SystemModelMessage {
    return this.systemMessage;
  }

  async getUserMessage(context: AgentContext): Promise<UserModelMessage> {
    return userMessage('');
  }
}
