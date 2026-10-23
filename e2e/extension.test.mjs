// End-to-end checks against the built extension in a real Chromium, with a fake OpenAI-compatible LLM.
// Run with `pnpm e2e` (builds first). One-time setup: `pnpm exec playwright-core install chromium`.
// Set E2E_HEADED=1 to watch the browser.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const extensionDir = path.resolve(import.meta.dirname, '..', 'dist');
const TARGET_PAGE = `<!doctype html><title>QA target</title><h1 id="status">idle</h1>
<button id="go" onclick="document.getElementById('status').textContent='clicked'">Go</button>`;
// The page echoes the received file so the test can check name and content.
const UPLOAD_PAGE = `<!doctype html><title>Upload target</title><h1 id="status">idle</h1>
<input id="file" type="file" onchange="this.files[0].text().then(t => document.getElementById('status').textContent = this.files[0].name + ':' + t)">`;

// Planner: keeps the task open until the navigator has acted once, then declares it done.
// Navigator: clicks the "Go" button from the DOM it receives, then finishes.
function fakeCompletion(body, state) {
  const tool = body.tools?.[0]?.function?.name ?? body.response_format?.json_schema?.name ?? '';
  const prompt = JSON.stringify(body.messages ?? []);
  let payload;
  if (/planner/i.test(tool)) {
    const done = state.navigatorSteps >= 2;
    payload = {
      observation: 'page loaded',
      challenges: '',
      done,
      next_steps: 'click Go',
      final_answer: done ? 'Go was clicked' : '',
      reasoning: 'fake',
      web_task: true,
    };
  } else {
    state.navigatorSteps += 1;
    const brain = { evaluation_previous_goal: 'ok', memory: '', next_goal: 'finish' };
    // The DOM reaches the model as `[0][ref=e0]<button >Go />`.
    const index = prompt.match(/\[(\d+)\](?:\[ref=e\d+\])?<button[^>]*>Go \/>/)?.[1];
    const fileIndex = prompt.match(/\[(\d+)\](?:\[ref=e\d+\])?<input[^\]]*?file/)?.[1];
    const first = state.navigatorSteps === 1;
    payload =
      first && index !== undefined
        ? { current_state: brain, action: [{ click_element: { intent: 'click go', index: Number(index) } }] }
        : first && fileIndex !== undefined
          ? {
              current_state: brain,
              action: [
                {
                  upload_file: {
                    intent: 'attach csv',
                    index: Number(fileIndex),
                    file_name: 'report.csv',
                    content: 'a,b\n1,2',
                  },
                },
              ],
            }
          : { current_state: brain, action: [{ done: { text: 'done', success: true } }] };
  }
  // LangChain asks either for a tool call or for a response_format JSON reply; answer in the same shape.
  const viaTool = Boolean(body.tools?.length);
  const message = viaTool
    ? {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: tool, arguments: JSON.stringify(payload) } }],
      }
    : { role: 'assistant', content: JSON.stringify(payload) };
  return {
    id: 'fake',
    object: 'chat.completion',
    created: 0,
    model: body.model,
    choices: [{ index: 0, message, finish_reason: viaTool ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

describe('extension e2e', { timeout: 180_000 }, () => {
  const state = { navigatorSteps: 0, delayMs: 0 };
  const pageErrors = [];
  let server;
  let baseUrl;
  let context;
  let extensionId;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(req.url.startsWith('/upload') ? UPLOAD_PAGE : TARGET_PAGE);
      }
      let raw = '';
      req.on('data', chunk => (raw += chunk));
      req.on('end', () => {
        const reply = () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(fakeCompletion(JSON.parse(raw), state)));
        };
        // Optional latency so a test can pause while a model call is in flight
        if (state.delayMs) setTimeout(reply, state.delayMs);
        else reply();
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    context = await chromium.launchPersistentContext('', {
      // The full Chromium build (new headless) loads extensions; the default headless shell does not.
      channel: 'chromium',
      headless: !process.env.E2E_HEADED,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).host;
  });

  after(async () => {
    await context?.close();
    await new Promise(resolve => server?.close(resolve));
  });

  async function openExtensionPage(file) {
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(`${file}: ${error.message}`));
    await page.goto(`chrome-extension://${extensionId}/${file}`);
    return page;
  }

  it('renders the options page and the side panel without errors', async () => {
    for (const file of ['options/index.html', 'side-panel/index.html']) {
      const page = await openExtensionPage(file);
      await page.locator('#app-container > *').first().waitFor();
      await page.close();
    }
    assert.deepEqual(pageErrors, []);
  });

  it('runs a planner + navigator task that clicks a real button', async () => {
    const target = await context.newPage();
    await target.goto(`${baseUrl}/page`);

    // chrome.* is not exposed to Playwright's service-worker evaluate, so drive it from an extension page.
    // Only the side panel URL may open the agent port (the background rejects any other sender).
    const panel = await openExtensionPage('side-panel/index.html');
    await panel.evaluate(async llmBaseUrl => {
      await chrome.storage.local.set({
        'llm-api-keys': {
          providers: {
            openai: {
              name: 'OpenAI',
              type: 'openai',
              apiKey: 'sk-test',
              baseUrl: llmBaseUrl,
              modelNames: ['gpt-4o'],
              createdAt: 1,
            },
          },
        },
        'agent-models': {
          agents: {
            planner: { provider: 'openai', modelName: 'gpt-4o' },
            navigator: { provider: 'openai', modelName: 'gpt-4o' },
          },
        },
      });
    }, `${baseUrl}/v1`);
    const tabId = await panel.evaluate(async url => (await chrome.tabs.query({ url: `${url}/*` }))[0]?.id, baseUrl);
    assert.ok(tabId, 'target tab not found');

    // Same port protocol the side panel uses (SIDE_PANEL_CONNECTION_PORT_NAME / new_task).
    const events = panel.evaluate(
      targetTabId =>
        new Promise(resolve => {
          const seen = [];
          const port = chrome.runtime.connect({ name: 'side-panel-connection' });
          setTimeout(() => resolve(seen), 120_000);
          port.onMessage.addListener(message => {
            if (message.type !== 'execution') return;
            seen.push(`${message.actor}:${message.state}`);
            if (['task.ok', 'task.fail', 'task.cancel'].includes(message.state)) resolve(seen);
          });
          port.postMessage({
            type: 'new_task',
            task: 'Click the Go button',
            taskId: 'e2e-task',
            tabId: targetTabId,
            options: { mode: 'act', permissionMode: 'auto', tabIds: [targetTabId] },
          });
        }),
      tabId,
    );

    const seen = await events;
    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.equal(await target.locator('#status').textContent(), 'clicked');
    // The task's tab stays in a tab group after the task ends (the group is kept, only marked done)
    const groupId = await panel.evaluate(id => chrome.tabs.get(id).then(tab => tab.groupId), tabId);
    assert.notEqual(groupId, -1, 'task tab was not put in a tab group');
    assert.deepEqual(pageErrors, []);
  });

  it('pauses during a model call, resumes, and still completes the task', async () => {
    state.navigatorSteps = 0;
    state.delayMs = 2500;
    const target = await context.newPage();
    await target.goto(`${baseUrl}/page`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(async url => (await chrome.tabs.query({ url: `${url}/*` })).at(-1)?.id, baseUrl);
    assert.ok(tabId, 'target tab not found');

    // Pause lands while the first model call is in flight; resume follows once the pause is acknowledged.
    const seen = await panel.evaluate(
      targetTabId =>
        new Promise(resolve => {
          const events = [];
          const port = chrome.runtime.connect({ name: 'side-panel-connection' });
          const finish = () => resolve(events);
          setTimeout(finish, 120_000);
          port.onMessage.addListener(message => {
            if (message.type === 'execution') {
              events.push(`${message.actor}:${message.state}`);
              if (message.state === 'task.pause') setTimeout(() => port.postMessage({ type: 'resume_task' }), 4000);
              if (['task.ok', 'task.fail', 'task.cancel'].includes(message.state)) finish();
            }
          });
          port.postMessage({
            type: 'new_task',
            task: 'Click the Go button',
            taskId: 'e2e-pause-task',
            tabId: targetTabId,
            options: { mode: 'act', permissionMode: 'auto', tabIds: [targetTabId] },
          });
          setTimeout(() => port.postMessage({ type: 'pause_task' }), 1000);
        }),
      tabId,
    );

    state.delayMs = 0;
    assert.ok(seen.includes('system:task.pause'), `pause was not reported: ${seen.join(', ')}`);
    assert.ok(seen.includes('system:task.resume'), `resume was not reported: ${seen.join(', ')}`);
    assert.ok(seen.includes('system:task.ok'), `task did not complete after resume: ${seen.join(', ')}`);
    assert.equal(await target.locator('#status').textContent(), 'clicked');
    assert.deepEqual(pageErrors, []);
  });

  it('attaches a file to a file input with the upload_file action', async () => {
    state.navigatorSteps = 0;
    const target = await context.newPage();
    await target.goto(`${baseUrl}/upload`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/upload` }))[0]?.id,
      baseUrl,
    );
    assert.ok(tabId, 'upload tab not found');

    const seen = await panel.evaluate(
      targetTabId =>
        new Promise(resolve => {
          const events = [];
          const port = chrome.runtime.connect({ name: 'side-panel-connection' });
          setTimeout(() => resolve(events), 120_000);
          port.onMessage.addListener(message => {
            if (message.type !== 'execution') return;
            events.push(`${message.actor}:${message.state}`);
            if (['task.ok', 'task.fail', 'task.cancel'].includes(message.state)) resolve(events);
          });
          port.postMessage({
            type: 'new_task',
            task: 'Attach a CSV report',
            taskId: 'e2e-upload-task',
            tabId: targetTabId,
            options: { mode: 'act', permissionMode: 'auto', tabIds: [targetTabId] },
          });
        }),
      tabId,
    );

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.equal(await target.locator('#status').textContent(), 'report.csv:a,b\n1,2');
    assert.deepEqual(pageErrors, []);
  });
});
