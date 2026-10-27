import { describe, expect, it } from 'vitest';
import MessageManager, { MessageManagerSettings } from '../service';
import { userMessage } from '../model-messages';

const managerWith = (sensitiveData: Record<string, string>) =>
  new MessageManager(new MessageManagerSettings({ sensitiveData }));

describe('MessageManager sensitive data filtering', () => {
  it('replaces every occurrence of a sensitive value with its placeholder', () => {
    const manager = managerWith({ password: 'hunter2' });

    manager.addMessageWithTokens(userMessage('login with hunter2, then retype hunter2 to confirm'));

    expect(manager.getMessages().map(m => m.content)).toEqual([
      'login with <secret>password</secret>, then retype <secret>password</secret> to confirm',
    ]);
  });

  it('filters every text part of a multi-part message', () => {
    const manager = managerWith({ token: 'abc' });

    manager.addMessageWithTokens({
      role: 'user',
      content: [
        { type: 'text', text: 'abc and abc' },
        { type: 'text', text: 'abc' },
      ],
    } as ReturnType<typeof userMessage>);

    expect(manager.getMessages()[0].content).toEqual([
      { type: 'text', text: '<secret>token</secret> and <secret>token</secret>' },
      { type: 'text', text: '<secret>token</secret>' },
    ]);
  });

  it('leaves the message unchanged when no sensitive value is present', () => {
    const manager = managerWith({ password: 'hunter2' });

    manager.addMessageWithTokens(userMessage('nothing secret here'));

    expect(manager.getMessages()[0].content).toBe('nothing secret here');
  });
});
