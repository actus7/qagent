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
import type { BrowserEngineName } from '../../browser/types';

/** Only the content-script engine needs a note: its action list lacks the debugger-backed tools the template describes. */
const CONTENT_SCRIPT_NOTE =
  'This browser has no debugger. click_at, hover, drag, read_console_messages, read_network_requests, resize_viewport, screenshot, read_theme, audit_contrast, page_info, find_progress, wait_for_element, switch_frame, WebMCP tools and captcha tools are not available. Use click, fill, press, scroll, get_text and execute_javascript instead.';

export class NavigatorPrompt extends BasePrompt {
  private systemMessage: SystemModelMessage;

  constructor(
    private readonly maxActionsPerStep = 10,
    reportStyle: ReportStyle = 'qa',
    browserEngine: BrowserEngineName = 'chrome-debugger',
  ) {
    super();

    const promptTemplate = navigatorSystemPromptTemplate;
    const doneRules = reportStyle === 'qa' ? NAVIGATOR_QA_DONE_RULES : NAVIGATOR_CONCISE_DONE_RULES;
    // Format the template with the maxActionsPerStep and the done-text rules for this task
    const formattedPrompt = promptTemplate
      .replace('{{max_actions}}', this.maxActionsPerStep.toString())
      .replace('{{done_rules}}', doneRules)
      .trim();
    const withEngineNote =
      browserEngine === 'content-script'
        ? `${formattedPrompt}

${CONTENT_SCRIPT_NOTE}`
        : formattedPrompt;
    this.systemMessage = systemMessage(withEngineNote);
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
