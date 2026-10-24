import type { FilePart, SystemModelMessage, UserModelMessage } from 'ai';
import { MessageHistory, MessageMetadata } from '@src/background/agent/messages/views';
import {
  AGENT_OUTPUT_TOOL,
  assistantMessage,
  assistantToolCall,
  isImagePart,
  messageText,
  type ModelMessage,
  toolResultMessage,
  userMessage,
} from './model-messages';
import { createLogger } from '@src/background/log';
import {
  filterExternalContent,
  wrapUserRequest,
  splitUserTextAndAttachments,
  wrapAttachments,
} from '@src/background/agent/messages/utils';

const logger = createLogger('MessageManager');

export class MessageManagerSettings {
  maxInputTokens = 128000;
  estimatedCharactersPerToken = 3;
  imageTokens = 800;
  includeAttributes: string[] = [];
  messageContext?: string;
  sensitiveData?: Record<string, string>;
  availableFilePaths?: string[];

  constructor(
    options: {
      maxInputTokens?: number;
      estimatedCharactersPerToken?: number;
      imageTokens?: number;
      includeAttributes?: string[];
      messageContext?: string;
      sensitiveData?: Record<string, string>;
      availableFilePaths?: string[];
    } = {},
  ) {
    if (options.maxInputTokens !== undefined) this.maxInputTokens = options.maxInputTokens;
    if (options.estimatedCharactersPerToken !== undefined)
      this.estimatedCharactersPerToken = options.estimatedCharactersPerToken;
    if (options.imageTokens !== undefined) this.imageTokens = options.imageTokens;
    if (options.includeAttributes !== undefined) this.includeAttributes = options.includeAttributes;
    if (options.messageContext !== undefined) this.messageContext = options.messageContext;
    if (options.sensitiveData !== undefined) this.sensitiveData = options.sensitiveData;
    if (options.availableFilePaths !== undefined) this.availableFilePaths = options.availableFilePaths;
  }
}

export default class MessageManager {
  private history: MessageHistory;
  private toolId: number;
  private settings: MessageManagerSettings;

  constructor(settings: MessageManagerSettings = new MessageManagerSettings()) {
    this.settings = settings;
    this.history = new MessageHistory();
    this.toolId = 1;
  }

  public initTaskMessages(
    systemMessage: SystemModelMessage,
    task: string,
    messageContext?: string,
    images: FilePart[] = [],
  ): void {
    // Add system message
    this.addMessageWithTokens(systemMessage, 'init');

    // Add context message if provided
    if (messageContext && messageContext.length > 0) {
      this.addMessageWithTokens(userMessage(`Context for the task: ${messageContext}`), 'init');
    }

    // Add task instructions
    const taskMessage = MessageManager.taskInstructions(task, images);
    this.addMessageWithTokens(taskMessage, 'init');

    // Add sensitive data info if sensitive data is provided
    if (this.settings.sensitiveData) {
      const info = `Here are placeholders for sensitive data: ${Object.keys(this.settings.sensitiveData)}`;
      this.addMessageWithTokens(userMessage(`${info}\nTo use them, write <secret>the placeholder name</secret>`), 'init');
    }

    // Add example output
    this.addMessageWithTokens(userMessage('Example output:'), 'init');

    const toolCallId = this.nextToolId();
    const exampleOutput = {
      current_state: {
        evaluation_previous_goal:
          `Success - I successfully clicked on the 'Apple' link from the Google Search results page,
              which directed me to the 'Apple' company homepage. This is a good start toward finding
              the best place to buy a new iPhone as the Apple website often list iPhones for sale.`.trim(),
        memory: `I searched for 'iPhone retailers' on Google. From the Google Search results page,
              I used the 'click_element' tool to click on a element labelled 'Best Buy' but calling
              the tool did not direct me to a new page. I then used the 'click_element' tool to click
              on a element labelled 'Apple' which redirected me to the 'Apple' company homepage.
              Currently at step 3/15.`.trim(),
        next_goal: `Looking at reported structure of the current page, I can see the item '[127]<h3 iPhone/>'
              in the content. I think this button will lead to more information and potentially prices
              for iPhones. I'll click on the link to 'iPhone' at index [127] using the 'click_element'
              tool and hope to see prices on the next page.`.trim(),
      },
      action: [{ click_element: { index: 127 } }],
    };

    this.addMessageWithTokens(assistantToolCall(AGENT_OUTPUT_TOOL, String(toolCallId), exampleOutput), 'init');
    this.addToolMessage('Browser started', toolCallId, 'init');

    // Add history start marker
    this.addMessageWithTokens(userMessage('[Your task history memory starts here]'));

    // Add available file paths if provided
    if (this.settings.availableFilePaths && this.settings.availableFilePaths.length > 0) {
      this.addMessageWithTokens(
        userMessage(`Here are file paths you can use: ${this.settings.availableFilePaths}`),
        'init',
      );
    }
  }

  public nextToolId(): number {
    const id = this.toolId;
    this.toolId += 1;
    return id;
  }

  /**
   * Createthe task instructions
   * @param task - The raw description of the task
   * @returns A user message containing the task instructions
   */
  private static taskInstructions(task: string, images: FilePart[] = []): UserModelMessage {
    const { userText, attachmentsInner } = splitUserTextAndAttachments(task);

    // Filter and wrap user text
    const cleanedTask = filterExternalContent(userText);
    const content = `Your ultimate task is: """${cleanedTask}""". If you achieved your ultimate task, stop everything and use the done action in the next step to complete the task. If not, continue as usual.`;
    const wrappedUser = wrapUserRequest(content, false);

    // Filter and wrap attachments as untrusted content
    const text =
      attachmentsInner && attachmentsInner.length > 0
        ? `${wrappedUser}\n\n${wrapAttachments(attachmentsInner)}`
        : wrappedUser;
    // Images are attached to the first task message so the navigator sees them with the task
    if (images.length > 0) {
      return userMessage([{ type: 'text', text }, ...images]);
    }
    return userMessage(text);
  }

  /**
   * Returns the number of messages in the history
   * @returns The number of messages in the history
   */
  public length(): number {
    return this.history.messages.length;
  }

  /**
   * Adds a new task to execute, it will be executed based on the history
   * @param newTask - The raw description of the new task
   */
  public addNewTask(newTask: string): void {
    const { userText, attachmentsInner } = splitUserTextAndAttachments(newTask);

    // Filter and wrap user text
    const cleanedTask = filterExternalContent(userText);
    const content = `Your new ultimate task is: """${cleanedTask}""". This is a follow-up of the previous tasks. Make sure to take all of the previous context into account and finish your new ultimate task.`;
    const wrappedUser = wrapUserRequest(content, false);

    // Filter and wrap attachments as untrusted content
    let finalContent = wrappedUser;
    if (attachmentsInner && attachmentsInner.length > 0) {
      const wrappedFiles = wrapAttachments(attachmentsInner);
      finalContent = `${wrappedUser}\n\n${wrappedFiles}`;
    }

    this.addMessageWithTokens(userMessage(finalContent));
  }

  /**
   * Adds a plan message to the history
   * @param plan - The raw description of the plan
   * @param position - The position to add the plan
   */
  public addPlan(plan?: string, position?: number): void {
    if (plan) {
      const cleanedPlan = filterExternalContent(plan, false);
      this.addMessageWithTokens(assistantMessage(`<plan>${cleanedPlan}</plan>`), null, position);
    }
  }

  /**
   * Adds a state message to the history
   * @param stateMessage - The user message containing the state
   */
  public addStateMessage(stateMessage: UserModelMessage): void {
    this.addMessageWithTokens(stateMessage);
  }

  /**
   * Adds a model output message to the history
   * @param modelOutput - The model output
   */
  public addModelOutput(modelOutput: Record<string, unknown>): void {
    const toolCallId = this.nextToolId();
    this.addMessageWithTokens(assistantToolCall(AGENT_OUTPUT_TOOL, String(toolCallId), modelOutput, 'tool call'));

    // Need a placeholder for the tool response here to avoid errors sometimes
    // NOTE: in browser-use, it uses an empty string
    this.addToolMessage('tool call response', toolCallId);
  }

  /**
   * Removes the last state message from the history
   */
  public removeLastStateMessage(): void {
    this.history.removeLastStateMessage();
  }

  public getMessages(): ModelMessage[] {
    const messages = this.history.messages
      .filter(m => {
        if (!m.message) {
          logger.error(`[MessageManager] Filtering out message with undefined message property:`, m);
          return false;
        }
        return true;
      })
      .map(m => m.message);

    let totalInputTokens = 0;
    logger.debug(`Messages in history: ${this.history.messages.length}:`);

    for (const m of this.history.messages) {
      totalInputTokens += m.metadata.tokens;
      if (m.message) {
        logger.debug(`${m.message.role} - Token count: ${m.metadata.tokens}`);
      } else {
        logger.error(`[MessageManager] Found message with undefined message property:`, m);
        logger.debug(`Message with undefined message property - Token count: ${m.metadata.tokens}`);
      }
    }

    logger.debug(`Total input tokens: ${totalInputTokens}`);
    return messages;
  }

  /**
   * Adds a message to the history with the token count metadata
   * @param message - The message to add
   * @param messageType - The type of the message (optional)
   * @param position - The optional position to add the message, if not provided, the message will be added to the end of the history
   */
  public addMessageWithTokens(message: ModelMessage, messageType?: string | null, position?: number): void {
    // filter out sensitive data if provided
    const filteredMessage = this.settings.sensitiveData ? this._filterSensitiveData(message) : message;

    const tokenCount = this._countTokens(filteredMessage);
    const metadata: MessageMetadata = new MessageMetadata(tokenCount, messageType);
    this.history.addMessage(filteredMessage, metadata, position);
  }

  /**
   * Returns a copy of the message with sensitive values replaced by their placeholders
   * @param message - The message to filter
   * @returns The filtered message
   */
  private _filterSensitiveData(message: ModelMessage): ModelMessage {
    const replaceSensitive = (value: string): string => {
      let filteredValue = value;
      if (!this.settings.sensitiveData) return filteredValue;

      for (const [key, val] of Object.entries(this.settings.sensitiveData)) {
        // Skip empty values to match Python behavior
        if (!val) continue;
        filteredValue = filteredValue.replace(val, `<secret>${key}</secret>`);
      }
      return filteredValue;
    };

    if (typeof message.content === 'string') {
      return { ...message, content: replaceSensitive(message.content) } as ModelMessage;
    }
    const content = message.content.map(part => (part.type === 'text' ? { ...part, text: replaceSensitive(part.text) } : part));
    return { ...message, content } as ModelMessage;
  }

  /**
   * Counts the tokens in the message
   * @param message - The message to count the tokens
   * @returns The number of tokens in the message
   */
  private _countTokens(message: ModelMessage): number {
    const images = Array.isArray(message.content) ? message.content.filter(part => isImagePart(part)).length : 0;
    return images * this.settings.imageTokens + this._countTextTokens(messageText(message));
  }

  /**
   * Counts the tokens in the text
   * Rough estimate, no tokenizer provided for now
   * @param text - The text to count the tokens
   * @returns The number of tokens in the text
   */
  private _countTextTokens(text: string): number {
    return Math.floor(text.length / this.settings.estimatedCharactersPerToken);
  }

  /**
   * Cuts the last message if the total tokens exceed the max input tokens
   *
   * Get current message list, potentially trimmed to max tokens
   */
  public cutMessages(): void {
    let diff = this.history.totalTokens - this.settings.maxInputTokens;
    if (diff <= 0) return;

    const lastMsg = this.history.messages[this.history.messages.length - 1];
    if (!lastMsg) {
      return;
    }

    // if list with image remove image
    if (Array.isArray(lastMsg.message.content)) {
      const images = lastMsg.message.content.filter(part => isImagePart(part)).length;
      if (images > 0) {
        const removed = images * this.settings.imageTokens;
        lastMsg.metadata.tokens -= removed;
        this.history.totalTokens -= removed;
        logger.debug(
          `Removed ${images} image(s) with ${removed} tokens - total tokens now: ${this.history.totalTokens}/${this.settings.maxInputTokens}`,
        );
      }
      const text = lastMsg.message.content
        .map(part => (part.type === 'text' ? part.text : ''))
        .join('');
      this.history.messages[this.history.messages.length - 1] = {
        ...lastMsg,
        message: { ...lastMsg.message, content: text } as ModelMessage,
      };
    }

    diff = this.history.totalTokens - this.settings.maxInputTokens;
    if (diff <= 0) return;

    const trimmed = this.history.messages[this.history.messages.length - 1];
    if (trimmed.message.role !== 'user' || typeof trimmed.message.content !== 'string' || trimmed.metadata.tokens <= 0) {
      this.trimToTokenBudget();
      return;
    }

    // if still over, remove text from state message proportionally to the number of tokens needed with buffer
    // Calculate the proportion of content to remove
    const proportionToRemove = diff / trimmed.metadata.tokens;
    if (proportionToRemove > 0.99) {
      this.trimToTokenBudget();
      return;
    }

    logger.debug(
      `Removing ${(proportionToRemove * 100).toFixed(2)}% of the last message (${(proportionToRemove * trimmed.metadata.tokens).toFixed(2)} / ${trimmed.metadata.tokens.toFixed(2)} tokens)`,
    );

    const content = trimmed.message.content;
    const charactersToRemove = Math.floor(content.length * proportionToRemove);
    const newContent = content.slice(0, -charactersToRemove);

    // remove tokens and old long message
    this.history.removeMessage();

    // new message with updated content
    this.addMessageWithTokens(userMessage(newContent));
    this.trimToTokenBudget();

    const finalMsg = this.history.messages[this.history.messages.length - 1];
    logger.debug(
      `Added message with ${finalMsg.metadata.tokens} tokens - total tokens now: ${this.history.totalTokens}/${this.settings.maxInputTokens} - total messages: ${this.history.messages.length}`,
    );
  }

  private trimToTokenBudget(): void {
    while (this.history.totalTokens > this.settings.maxInputTokens && this.history.messages.length > 1) {
      const before = this.history.totalTokens;
      this.history.removeOldestMessage();
      if (this.history.totalTokens >= before) {
        break;
      }
    }
  }

  /**
   * Adds a tool message to the history
   * @param content - The content of the tool message
   * @param toolCallId - The tool call id of the tool message, if not provided, a new tool call id will be generated
   * @param messageType - The type of the tool message
   */
  public addToolMessage(content: string, toolCallId?: number, messageType?: string | null): void {
    const id = toolCallId ?? this.nextToolId();
    this.addMessageWithTokens(toolResultMessage(AGENT_OUTPUT_TOOL, String(id), content), messageType);
  }
}
