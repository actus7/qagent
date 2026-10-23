import { BasePrompt } from './base';
import { type HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { navigatorSystemPromptTemplate } from './templates/navigator';

export class NavigatorPrompt extends BasePrompt {
  private systemMessage: SystemMessage;

  constructor(private readonly maxActionsPerStep = 10) {
    super();

    const promptTemplate = navigatorSystemPromptTemplate;
    // Format the template with the maxActionsPerStep
    const formattedPrompt = promptTemplate.replace('{{max_actions}}', this.maxActionsPerStep.toString()).trim();
    this.systemMessage = new SystemMessage(formattedPrompt);
  }

  getSystemMessage(): SystemMessage {
    /**
     * Get the system prompt for the agent.
     *
     * @returns SystemMessage containing the formatted system prompt
     */
    return this.systemMessage;
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return await this.buildBrowserStateUserMessage(context);
  }
}
