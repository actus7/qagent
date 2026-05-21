# Agent Browser (Node)

This module provides:

- `BrowserSessionManager`: multi-session `BrowserManager` lifecycle with idle timeout.
- `browserTool`: MCP-style action handler (`open`, `snapshot`, `click`, `fill`, etc.).

## Quick usage

```ts
import { BrowserSessionManager, createBrowserTool } from '@extension/dev-utils';

const manager = new BrowserSessionManager({
  launch: { headless: true },
  sessionTimeoutMs: 15 * 60 * 1000,
  onScreencastFrame: (sessionId, frame) => {
    // Send frame.data to WebSocket clients
  },
});

const browse = createBrowserTool(manager);

await browse({
  sessionId: 'user-123',
  action: 'open',
  url: 'https://example.com',
});

const snapshot = await browse({
  sessionId: 'user-123',
  action: 'snapshot',
  interactive: true,
  compact: true,
});

await browse({
  sessionId: 'user-123',
  action: 'click',
  selector: '@e2',
});
```

## BrowserManager-compatible usage

```ts
import { BrowserManager } from '@extension/dev-utils';

const browser = new BrowserManager();
await browser.launch({ headless: true });
await browser.navigate('https://example.com');
```

## Companion server

Start the localhost WebSocket companion:

```bash
pnpm -F @extension/dev-utils ready
pnpm -F @extension/dev-utils companion
```

It binds by default to `ws://127.0.0.1:9223` and supports RPC + stream + input messages in one socket.

## Notes

- The current `agent-browser` npm package exports `BrowserManager` via `agent-browser/dist/browser.js`.
- `start_screencast` requires `onScreencastFrame` in manager options (or explicit callback in manager API).
