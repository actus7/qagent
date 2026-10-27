import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('webextension-polyfill', () => ({}));

const { transport, connect, connectTab } = vi.hoisted(() => ({
  transport: { close: vi.fn() },
  connect: vi.fn(),
  connectTab: vi.fn(),
}));
vi.mock('puppeteer-core/internal/puppeteer-core-browser.js', () => ({
  connect,
  ExtensionTransport: { connectTab },
}));

import Page from '../page';

describe('attachPuppeteer when the CDP handshake fails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectTab.mockResolvedValue(transport);
  });

  it('closes the transport so the chrome.debugger attachment is released', async () => {
    connect.mockRejectedValue(new Error('protocol handshake failed'));
    const page = new Page(7, 'https://example.com', 'Example');

    await expect(page.attachPuppeteer()).rejects.toThrow('protocol handshake failed');

    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(page.attached).toBe(false);
  });
});
