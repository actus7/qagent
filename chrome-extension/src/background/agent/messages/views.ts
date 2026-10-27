import type { ModelMessage } from './model-messages';

export class MessageMetadata {
  tokens: number;
  message_type: string | null = null;

  constructor(tokens: number, message_type?: string | null) {
    this.tokens = tokens;
    this.message_type = message_type ?? null;
  }
}

class ManagedMessage {
  message: ModelMessage;
  metadata: MessageMetadata;

  constructor(message: ModelMessage, metadata: MessageMetadata) {
    this.message = message;
    this.metadata = metadata;
  }
}

export class MessageHistory {
  messages: ManagedMessage[] = [];
  totalTokens = 0;

  addMessage(message: ModelMessage, metadata: MessageMetadata, position?: number): void {
    const managedMessage: ManagedMessage = {
      message,
      metadata,
    };

    if (position === undefined) {
      this.messages.push(managedMessage);
    } else {
      this.messages.splice(position, 0, managedMessage);
    }
    this.totalTokens += metadata.tokens;
  }

  removeMessage(index = -1): void {
    if (this.messages.length > 0) {
      const msg = this.messages.splice(index, 1)[0];
      this.totalTokens -= msg.metadata.tokens;
    }
  }

  /**
   * Removes the last message from the history if it is a user message.
   * This is used to remove the state message from the history.
   */
  removeLastStateMessage(): void {
    if (this.messages.length > 2 && this.messages[this.messages.length - 1].message.role === 'user') {
      const msg = this.messages.pop();
      if (msg) {
        this.totalTokens -= msg.metadata.tokens;
      }
    }
  }

  /**
   * Get all messages
   */
  getMessages(): ModelMessage[] {
    return this.messages.map(m => m.message);
  }

  /**
   * Remove the oldest history message. System and 'init' messages (task, context, example) are kept:
   * dropping them first would leave the model working without knowing its goal.
   * Tool results that follow a removed tool call go with it, so no orphan tool message is sent.
   */
  removeOldestMessage(): void {
    const index = this.messages.findIndex(m => m.message.role !== 'system' && m.metadata.message_type !== 'init');
    if (index < 0) return;
    const [removed] = this.messages.splice(index, 1);
    this.totalTokens -= removed.metadata.tokens;
    while (this.messages[index]?.message.role === 'tool') {
      this.totalTokens -= this.messages.splice(index, 1)[0].metadata.tokens;
    }
  }
}
