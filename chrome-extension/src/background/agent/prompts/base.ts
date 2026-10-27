import type { SystemModelMessage, UserModelMessage } from 'ai';
import { userMessage } from '../messages/model-messages';
import type { AgentContext } from '@src/background/agent/types';
import { actionErrorForPrompt, wrapUntrustedContent } from '../messages/utils';
import { createLogger } from '@src/background/log';
import { loadPluginPromptSection } from '../../plugins/context';
import { loadMcpPromptSection } from '../../mcp/context';
import { buildTodoPromptSection } from '../actions/todo';

const logger = createLogger('BasePrompt');
/**
 * Abstract base class for all prompt types
 */
abstract class BasePrompt {
  /**
   * Returns the system message that defines the AI's role and behavior
   * @returns the system message
   */
  abstract getSystemMessage(): SystemModelMessage;

  /**
   * Returns the user message for the specific prompt type
   * @param context - Optional context data needed for generating the user message
   * @returns the user message
   */
  abstract getUserMessage(context: AgentContext): Promise<UserModelMessage>;

  /**
   * Builds the user message containing the browser state
   * @param context - The agent context
   * @returns the user message
   */
  async buildBrowserStateUserMessage(context: AgentContext): Promise<UserModelMessage> {
    // true: elements that appeared since the previous read are marked *[N], as the navigator prompt describes
    const browserState = await context.browserContext.getState(context.options.useVision, true);
    const rawElementsText = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);

    let formattedElementsText: string;
    if (rawElementsText !== '') {
      // A page shorter than the viewport has no scrollable distance: the viewport then covers all of it
      const scrollableDistance = browserState.scrollHeight - browserState.visualViewportHeight;
      const viewportPercent =
        scrollableDistance > 0 ? Math.round((browserState.visualViewportHeight / scrollableDistance) * 100) : 100;
      const scrollInfo = `[Scroll info of current page] window.scrollY: ${browserState.scrollY}, document.body.scrollHeight: ${browserState.scrollHeight}, window.visualViewport.height: ${browserState.visualViewportHeight}, visual viewport height as percentage of scrollable distance: ${viewportPercent}%\n`;
      logger.info(scrollInfo);
      const elementsText = wrapUntrustedContent(rawElementsText);
      formattedElementsText = `${scrollInfo}[Start of page]\n${elementsText}\n[End of page]\n`;
    } else {
      formattedElementsText = 'empty page';
    }
    if (browserState.stale) {
      formattedElementsText =
        '[The page could not be read this step; the elements below are from the last successful read and may be outdated. Prefer waiting or reloading before acting on them.]\n' +
        formattedElementsText;
    }

    let stepInfoDescription = '';
    if (context.stepInfo) {
      stepInfoDescription = `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}`;
    }

    const pluginsSection = await loadPluginPromptSection(browserState.url);
    const mcpSection = await loadMcpPromptSection(context);
    const todoSection = buildTodoPromptSection(context.todos);

    const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' '); // Format: YYYY-MM-DD HH:mm
    stepInfoDescription += `Current date and time: ${timeStr}`;

    let actionResultsDescription = '';
    if (context.actionResults.length > 0) {
      for (let i = 0; i < context.actionResults.length; i++) {
        const result = context.actionResults[i];
        if (result.extractedContent) {
          actionResultsDescription += `\nAction result ${i + 1}/${context.actionResults.length}: ${result.extractedContent}`;
        }
        if (result.error) {
          const error = actionErrorForPrompt(result.error);
          actionResultsDescription += `\nAction error ${i + 1}/${context.actionResults.length}: ...${error}`;
        }
      }
    }

    const currentTab = `{id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`;
    const otherTabs = browserState.tabs
      .filter(tab => tab.id !== browserState.tabId)
      .map(tab => `- {id: ${tab.id}, url: ${tab.url}, title: ${tab.title}}`);
    const stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current tab: ${currentTab}
Other available tabs:
  ${otherTabs.join('\n')}
${pluginsSection}${mcpSection}${todoSection}Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}
Use selectors from this snapshot and prefer refs in format @eN when available.
${stepInfoDescription}
${actionResultsDescription}
`;

    if (browserState.screenshot && context.options.useVision) {
      return userMessage([
        { type: 'text', text: stateDescription },
        { type: 'file', mediaType: 'image/jpeg', data: browserState.screenshot },
      ]);
    }

    return userMessage(stateDescription);
  }
}

export { BasePrompt };
