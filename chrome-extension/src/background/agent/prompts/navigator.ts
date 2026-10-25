import type { SystemModelMessage, UserModelMessage } from 'ai';
import { BasePrompt } from './base';
import { systemMessage } from '../messages/model-messages';
import type { AgentContext } from '@src/background/agent/types';
import {
  navigatorSystemPromptTemplate,
  NAVIGATOR_CONCISE_DONE_RULES,
  NAVIGATOR_QA_DONE_RULES,
} from './templates/navigator';
import type { ReportStyle } from '../task-kind';

export class NavigatorPrompt extends BasePrompt {
  private systemMessage: SystemModelMessage;

  constructor(
    private readonly maxActionsPerStep = 10,
    reportStyle: ReportStyle = 'qa',
  ) {
    super();

    const promptTemplate = navigatorSystemPromptTemplate;
    const doneRules = reportStyle === 'qa' ? NAVIGATOR_QA_DONE_RULES : NAVIGATOR_CONCISE_DONE_RULES;
    // Format the template with the maxActionsPerStep and the done-text rules for this task
    const formattedPrompt = promptTemplate
      .replace('{{max_actions}}', this.maxActionsPerStep.toString())
      .replace('{{done_rules}}', doneRules)
      .trim();
    this.systemMessage = systemMessage(formattedPrompt);
  }

  getSystemMessage(): SystemModelMessage {
    /**
     * Get the system prompt for the agent.
     *
     * @returns the formatted system prompt
     */
    return this.systemMessage;
  }

  async getUserMessage(context: AgentContext): Promise<UserModelMessage> {
    return await this.buildBrowserStateUserMessage(context);
  }
}
