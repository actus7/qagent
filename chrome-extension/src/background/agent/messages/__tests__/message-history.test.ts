import { describe, expect, it } from 'vitest';
import { MessageHistory, MessageMetadata } from '../views';
import type { ModelMessage } from '../model-messages';

const msg = (role: 'system' | 'user' | 'assistant' | 'tool', content: string) =>
  ({ role, content }) as unknown as ModelMessage;

describe('MessageHistory.removeOldestMessage', () => {
  it('keeps system and init messages and removes the oldest history message', () => {
    const history = new MessageHistory();
    history.addMessage(msg('system', 'sys'), new MessageMetadata(10, 'init'));
    history.addMessage(msg('user', 'task'), new MessageMetadata(10, 'init'));
    history.addMessage(msg('user', 'step 1'), new MessageMetadata(5));
    history.addMessage(msg('user', 'step 2'), new MessageMetadata(5));

    history.removeOldestMessage();

    expect(history.messages.map(m => m.message.content)).toEqual(['sys', 'task', 'step 2']);
    expect(history.totalTokens).toBe(25);
  });

  it('removes the tool results of a removed tool call with it', () => {
    const history = new MessageHistory();
    history.addMessage(msg('user', 'task'), new MessageMetadata(10, 'init'));
    history.addMessage(msg('assistant', 'call'), new MessageMetadata(4));
    history.addMessage(msg('tool', 'result'), new MessageMetadata(3));
    history.addMessage(msg('user', 'next'), new MessageMetadata(2));

    history.removeOldestMessage();

    expect(history.messages.map(m => m.message.content)).toEqual(['task', 'next']);
    expect(history.totalTokens).toBe(12);
  });

  it('does nothing when only init messages remain', () => {
    const history = new MessageHistory();
    history.addMessage(msg('user', 'task'), new MessageMetadata(10, 'init'));
    history.removeOldestMessage();
    expect(history.messages).toHaveLength(1);
  });
});
