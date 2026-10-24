import type { SystemModelMessage, UserModelMessage } from 'ai';
import { BasePrompt } from './base';
import { systemMessage } from '../messages/model-messages';
import type { AgentContext } from '@src/background/agent/types';
import { navigatorSystemPromptTemplate } from './templates/navigator';

export class NavigatorPrompt extends BasePrompt {
  private systemMessage: SystemModelMessage;

  constructor(private readonly maxActionsPerStep = 10) {
    super();

    const promptTemplate = navigatorSystemPromptTemplate;
    // Format the template with the maxActionsPerStep
    const formattedPrompt = promptTemplate.replace('{{max_actions}}', this.maxActionsPerStep.toString()).trim();
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
