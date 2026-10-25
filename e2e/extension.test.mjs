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

// Clicking Go logs an error and fetches a URL that 404s; the token in the query must never reach the model.
const TELEMETRY_PAGE = `<!doctype html><title>Telemetry target</title><h1 id="status">idle</h1>
<button id="go" onclick="console.error('boom'); fetch('/missing-api?token=s3cr3t')">Go</button>`;
// Clicking the pad at (150, 140) in CSS pixels echoes the click position.
const POINTER_PAGE = `<!doctype html><title>Pointer target</title><h1 id="status">idle</h1>
<div id="pad" style="position:absolute;left:100px;top:100px;width:200px;height:100px;background:#ccc"
  onclick="document.getElementById('status').textContent='clicked:'+Math.round(event.clientX)+','+Math.round(event.clientY)">pad</div>`;
// A controlled field like React's: a plain `.value =` is ignored, only the native setter and typing stick.
// It starts with stale text, so a fill that does not clear first leaves "old text" behind.
const UI_PAGE = `<!doctype html><title>UI target</title><h1 id="status">idle</h1>
<input id="name" aria-label="Name">
<output id="echo"></output>
<button id="save" style="position:absolute;top:20px;left:20px" onclick="document.getElementById('status').textContent='saved'">Save</button>
<div id="banner" style="position:fixed;top:0;left:0;right:0;height:80px;background:#fee;z-index:10">
  Cookie notice <button id="accept" onclick="document.getElementById('banner').remove()">Accept</button>
</div>
<div class="spinner" style="width:20px;height:20px;animation:spin 1s linear infinite"></div>
<div role="progressbar" aria-label="Upload" aria-valuenow="40" aria-valuemin="0" aria-valuemax="100" style="width:200px;height:10px;background:#ccc"></div>
<style>@keyframes spin { to { transform: rotate(360deg); } }</style>
<script>
  const input = document.getElementById('name');
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const echo = document.getElementById('echo');
  Object.defineProperty(input, 'value', { get: () => nativeValue.get.call(input), set: () => {} });
  input.addEventListener('input', () => { echo.textContent = input.value; });
  nativeValue.set.call(input, 'old text');
  echo.textContent = 'old text';
  // A button that appears after a delay, as a late-loading page would show it.
  setTimeout(() => {
    const ready = document.createElement('button');
    ready.textContent = 'Ready';
    ready.onclick = () => (document.getElementById('status').textContent = 'ready clicked');
    document.body.append(ready);
  }, 800);
</script>`;
// The top page embeds a cross-origin frame (localhost vs 127.0.0.1); the port is filled in by the server.
const frameHostPage = origin => `<!doctype html><title>Frame host</title><h1 id="status">idle</h1>
<iframe id="child" src="${origin}/inner" width="400" height="200"></iframe>`;
const INNER_PAGE = `<!doctype html><title>Inner frame</title>
<button id="inner-go" onclick="this.textContent='inner clicked'">Inner go</button>`;

// A page three times the viewport height, so a viewport-only capture would miss the bottom marker.
const TALL_PAGE = `<!doctype html><title>Tall page</title><h1>Top</h1>
<div style="height:3000px;background:linear-gradient(#fff,#9cf)">Bottom marker</div>`;
// The link downloads a CSV from the server; the test checks the saved file name.
const DOWNLOAD_PAGE = `<!doctype html><title>Download page</title><h1>Reports</h1>
<a href="/file/report-e2e.csv">Get CSV</a>`;
// A page that registers WebMCP tools on navigator.modelContext, with one tool that echoes its input.
const SITE_TOOLS_PAGE = `<!doctype html><title>Site tools page</title><h1>Items</h1>
<script>
  navigator.modelContext = {
    getTools: () => [{ name: 'add_item', description: 'Adds an item', inputSchema: { type: 'object' } }],
    executeTool: (name, args) => ({ added: args.name, tool: name }),
  };
</script>`;
// The watched text changes once, 1.5 s after load, which a monitor must report.
const MONITOR_PAGE = `<!doctype html><title>Monitor page</title><div id="feed">v1</div>
<script>setTimeout(() => (document.getElementById('feed').textContent = 'v2'), 1500);</script>`;

// Index of the "Go" button in the snapshot the navigator receives.
const goButtonIndex = prompt => Number(prompt.match(/\[(\d+)\](?:\[ref=e\d+\])?<button[^>]*>Go \/>/)?.[1]);

// Planner: keeps the task open until the navigator has acted once, then declares it done.
// Navigator: clicks the "Go" button from the DOM it receives, then finishes.
function fakeCompletion(body, state) {
  const tool = body.tools?.[0]?.function?.name ?? body.response_format?.json_schema?.name ?? '';
  const prompt = JSON.stringify(body.messages ?? []);
  let payload;
  if (/planner/i.test(tool)) {
    const done = state.navigatorSteps >= (state.script?.length ?? 2);
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
    state.navigatorPrompts.push(prompt);
    // The task note lists binary attachments by name; upload the one named in the note
    const hasBinaryAttachment = prompt.includes('notes.pdf');
    // A scripted run answers each navigator call with the next entry (a function receives the prompt).
    const scripted = state.script?.[state.navigatorSteps - 1];
    payload = state.script
      ? { current_state: brain, action: [typeof scripted === 'function' ? scripted(prompt) : scripted] }
      : first && index !== undefined
        ? { current_state: brain, action: [{ click_element: { intent: 'click go', index: Number(index) } }] }
        : first && fileIndex !== undefined && hasBinaryAttachment
          ? {
              current_state: brain,
              action: [
                {
                  upload_file: {
                    intent: 'attach pdf',
                    index: Number(fileIndex),
                    file_name: 'notes.pdf',
                    attachment: 'notes.pdf',
                  },
                },
              ],
            }
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

// Chat and plan answers stream (stream: true): reply with one SSE text chunk followed by the stop chunk.
function replyStream(res, body) {
  const chunk = (delta, finishReason) => ({
    id: 'fake',
    object: 'chat.completion.chunk',
    created: 0,
    model: body.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: 'It is an image.' }, null))}\n\n`);
  res.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
  res.end('data: [DONE]\n\n');
}

// Points the planner and navigator at the fake LLM. Runs from an extension page, where chrome.storage is available.
async function configureFakeLlm(panel, llmBaseUrl) {
  await panel.evaluate(async url => {
    await chrome.storage.local.set({
      'llm-api-keys': {
        providers: {
          openai: {
            name: 'OpenAI',
            type: 'openai',
            apiKey: 'sk-test',
            baseUrl: url,
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
  }, `${llmBaseUrl}/v1`);
}

describe('extension e2e', { timeout: 300_000 }, () => {
  const state = { navigatorSteps: 0, delayMs: 0, script: null, navigatorPrompts: [], imageRequests: 0 };
  const pageErrors = [];
  let server;
  let baseUrl;
  let context;
  let extensionId;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        if (req.url.startsWith('/file/report-e2e.csv')) {
          res.writeHead(200, {
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename="report-e2e.csv"',
          });
          return res.end('name,total\nada,2\n');
        }
        if (req.url.startsWith('/tall')) {
          res.writeHead(200, { 'content-type': 'text/html' });
          return res.end(TALL_PAGE);
        }
        if (req.url.startsWith('/download-page')) {
          res.writeHead(200, { 'content-type': 'text/html' });
          return res.end(DOWNLOAD_PAGE);
        }
        if (req.url.startsWith('/site-tools')) {
          res.writeHead(200, { 'content-type': 'text/html' });
          return res.end(SITE_TOOLS_PAGE);
        }
        if (req.url.startsWith('/monitor')) {
          res.writeHead(200, { 'content-type': 'text/html' });
          return res.end(MONITOR_PAGE);
        }
        if (req.url.startsWith('/missing-api')) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          return res.end('not found');
        }
        res.writeHead(200, { 'content-type': 'text/html' });
        if (req.url.startsWith('/telemetry')) return res.end(TELEMETRY_PAGE);
        if (req.url.startsWith('/pointer')) return res.end(POINTER_PAGE);
        if (req.url.startsWith('/ui')) return res.end(UI_PAGE);
        if (req.url.startsWith('/frame-host')) {
          // localhost is a different origin from the 127.0.0.1 page, so the iframe is cross-origin.
          return res.end(frameHostPage(`http://localhost:${server.address().port}`));
        }
        if (req.url.startsWith('/inner')) return res.end(INNER_PAGE);
        return res.end(req.url.startsWith('/upload') ? UPLOAD_PAGE : TARGET_PAGE);
      }
      let raw = '';
      req.on('data', chunk => (raw += chunk));
      req.on('end', () => {
        const body = JSON.parse(raw);
        // Image parts reach the model as image_url content; record them for the attachment tests
        if (raw.includes('"type":"image_url"')) state.imageRequests += 1;
        const reply = () => {
          if (body.stream) return replyStream(res, body);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(fakeCompletion(body, state)));
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
            // Two goals, so the planner runs (a single-goal task skips it); this test covers the planner path.
            task: 'Click the Go button, then confirm it',
            taskId: 'e2e-task',
            tabId: targetTabId,
            options: { mode: 'act', tabIds: [targetTabId] },
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
            // Two goals: a simple task skips the planner, and the fake navigator only clicks on its first call,
            // which the pause discards.
            task: 'Click the Go button, then confirm it',
            taskId: 'e2e-pause-task',
            tabId: targetTabId,
            options: { mode: 'act', tabIds: [targetTabId] },
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
            options: { mode: 'act', tabIds: [targetTabId] },
          });
        }),
      tabId,
    );

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.equal(await target.locator('#status').textContent(), 'report.csv:a,b\n1,2');
    assert.deepEqual(pageErrors, []);
  });

  // Runs one task through the side panel port and resolves with the execution states it reported.
  function runTask(panel, targetTabId, task, taskId, type = 'new_task') {
    return panel.evaluate(
      ({ targetTabId, task, taskId, type }) =>
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
            type,
            task,
            taskId,
            tabId: targetTabId,
            options: { mode: 'act', tabIds: [targetTabId] },
          });
        }),
      { targetTabId, task, taskId, type },
    );
  }

  it('continues the previous task when a follow-up is sent in the same chat', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = null;
    const target = await context.newPage();
    await target.goto(`${baseUrl}/page`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/page` })).at(-1)?.id,
      baseUrl,
    );
    assert.ok(tabId, 'target tab not found');

    const first = await runTask(panel, tabId, 'Click the Go button', 'e2e-followup-task');
    assert.ok(first.includes('system:task.ok'), `task 1 did not finish ok: ${first.join(', ')}`);

    // Task 2 reuses the chat (same taskId) through follow_up_task; the navigator must see task 1 in its prompt.
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [{ done: { text: 'Reviewed the earlier click', success: true } }];
    const second = await runTask(panel, tabId, 'Say what you already did', 'e2e-followup-task', 'follow_up_task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(second.includes('system:task.ok'), `task 2 did not finish ok: ${second.join(', ')}`);
    assert.ok(prompts[0]?.includes('Previous task: Click the Go button'), 'task 1 text was not sent for task 2');
    assert.ok(prompts[0]?.includes('Outcome: completed'), 'task 1 outcome was not sent for task 2');
    assert.ok(prompts[0]?.includes('Say what you already did'), 'task 2 request is missing');
    assert.deepEqual(pageErrors, []);
  });

  it('reads console errors and failed requests and hands them to the model', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      prompt => ({ click_element: { intent: 'trigger errors', index: goButtonIndex(prompt) } }),
      { read_console_messages: { intent: 'read errors', level: 'error' } },
      { read_network_requests: { intent: 'read failed requests', only_failed: true } },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/telemetry`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/telemetry` }))[0]?.id,
      baseUrl,
    );
    assert.ok(tabId, 'telemetry tab not found');

    const seen = await runTask(panel, tabId, 'Trigger the errors and check the logs', 'e2e-telemetry-task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    // Result of read_console_messages reaches the call after it; same for read_network_requests.
    assert.ok(prompts[2]?.includes('boom'), 'console error was not sent to the model');
    assert.ok(prompts[3]?.includes('-> 404'), 'failed request was not sent to the model');
    // The URL redactor writes token=REDACTED; the guardrails filter may replace that whole pair with [REDACTED_CREDENTIAL].
    assert.match(
      prompts[3],
      /missing-api\?(token=REDACTED|\[REDACTED_CREDENTIAL\])/,
      'sensitive query value was not redacted',
    );
    assert.ok(
      prompts.every(prompt => !prompt.includes('s3cr3t')),
      'secret query value reached the model',
    );
    assert.deepEqual(pageErrors, []);
  });

  it('clicks at pixel coordinates with click_at', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      { click_at: { intent: 'click the pad', x: 150, y: 140 } },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/pointer`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/pointer` }))[0]?.id,
      baseUrl,
    );
    assert.ok(tabId, 'pointer tab not found');

    const seen = await runTask(panel, tabId, 'Click the pad', 'e2e-pointer-task');
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.equal(await target.locator('#status').textContent(), 'clicked:150,140');
    assert.deepEqual(pageErrors, []);
  });

  it('sends an image attachment to the model in chat mode', async () => {
    const target = await context.newPage();
    await target.goto(`${baseUrl}/page`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(async url => (await chrome.tabs.query({ url: `${url}/page` }))[0]?.id, baseUrl);
    assert.ok(tabId, 'target tab not found');
    // 1x1 transparent PNG
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const before = state.imageRequests;

    const seen = await panel.evaluate(
      ({ targetTabId, image }) =>
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
            task: 'What is in this picture?',
            taskId: 'e2e-chat-image',
            tabId: targetTabId,
            options: { mode: 'chat', tabIds: [targetTabId] },
            attachments: [{ id: 'img-1', name: 'pixel.png', mimeType: 'image/png', kind: 'image', dataUrl: image }],
          });
        }),
      { targetTabId: tabId, image: dataUrl },
    );

    assert.ok(seen.includes('system:task.ok'), `chat task did not finish ok: ${seen.join(', ')}`);
    assert.equal(state.imageRequests, before + 1, 'the model did not receive an image_url content part');
    assert.deepEqual(pageErrors, []);
  });

  it('uploads a binary attachment with upload_file', async () => {
    state.navigatorSteps = 0;
    const target = await context.newPage();
    await target.goto(`${baseUrl}/upload`);
    const panel = await openExtensionPage('side-panel/index.html');
    // Earlier tests leave /upload tabs open; the newest one is the page this test opened
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/upload` })).at(-1)?.id,
      baseUrl,
    );
    assert.ok(tabId, 'upload tab not found');
    const pdfText = '%PDF-1.4 test';
    const dataUrl = `data:application/pdf;base64,${Buffer.from(pdfText).toString('base64')}`;

    const seen = await panel.evaluate(
      ({ targetTabId, file }) =>
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
            task: 'Attach the PDF',
            taskId: 'e2e-upload-binary-task',
            tabId: targetTabId,
            options: { mode: 'act', tabIds: [targetTabId] },
            attachments: [
              { id: 'file-1', name: 'notes.pdf', mimeType: 'application/pdf', kind: 'file', dataUrl: file },
            ],
          });
        }),
      { targetTabId: tabId, file: dataUrl },
    );

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.equal(await target.locator('#status').textContent(), `notes.pdf:${pdfText}`);
    assert.deepEqual(pageErrors, []);
  });

  it('pauses on request_user_takeover and completes after the user resumes', async () => {
    state.navigatorSteps = 0;
    state.script = [
      {
        request_user_takeover: {
          intent: 'login needed',
          reason: 'authentication',
          message: 'Faça login e devolva o controle.',
        },
      },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/takeover`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/takeover` }))[0]?.id,
      baseUrl,
    );
    assert.ok(tabId, 'takeover tab not found');

    const { events, takeover } = await panel.evaluate(
      targetTabId =>
        new Promise(resolve => {
          const events = [];
          let takeover = null;
          const port = chrome.runtime.connect({ name: 'side-panel-connection' });
          const finish = () => resolve({ events, takeover });
          setTimeout(finish, 120_000);
          port.onMessage.addListener(message => {
            if (message.type !== 'execution') return;
            events.push(`${message.actor}:${message.state}`);
            if (message.state === 'task.pause' && message.data.takeover) {
              takeover = message.data.takeover;
              // Hand control back after the pause is reported.
              setTimeout(() => port.postMessage({ type: 'resume_task' }), 500);
            }
            if (['task.ok', 'task.fail', 'task.cancel'].includes(message.state)) finish();
          });
          port.postMessage({
            type: 'new_task',
            task: 'Log in to the account',
            taskId: 'e2e-takeover-task',
            tabId: targetTabId,
            options: { mode: 'act', tabIds: [targetTabId] },
          });
        }),
      tabId,
    );
    state.script = null;

    assert.ok(events.includes('navigator:task.pause'), `takeover did not pause: ${events.join(', ')}`);
    assert.equal(takeover?.reason, 'authentication');
    assert.equal(takeover?.message, 'Faça login e devolva o controle.');
    assert.ok(events.includes('system:task.resume'), `resume was not reported: ${events.join(', ')}`);
    assert.ok(events.includes('system:task.ok'), `task did not complete after resume: ${events.join(', ')}`);
    assert.deepEqual(pageErrors, []);
  });

  it('holds the task on ask_user until the side panel answers', async () => {
    state.navigatorSteps = 0;
    state.script = [
      { ask_user: { intent: 'need a plan', question: 'Which plan?', options: ['Basic', 'Pro'] } },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/ask-user`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/ask-user` }))[0]?.id,
      baseUrl,
    );
    assert.ok(tabId, 'ask-user tab not found');

    const { events, question } = await panel.evaluate(
      targetTabId =>
        new Promise(resolve => {
          const events = [];
          let question = null;
          const port = chrome.runtime.connect({ name: 'side-panel-connection' });
          const finish = () => resolve({ events, question });
          setTimeout(finish, 120_000);
          port.onMessage.addListener(message => {
            if (message.type !== 'execution') return;
            events.push(`${message.actor}:${message.state}`);
            if (message.data.question && !question) {
              question = message.data.question;
              // The panel answers the question once it is shown.
              setTimeout(() => port.postMessage({ type: 'answer_question', text: 'Pro' }), 500);
            }
            if (['task.ok', 'task.fail', 'task.cancel'].includes(message.state)) finish();
          });
          port.postMessage({
            type: 'new_task',
            task: 'Choose a plan for the account',
            taskId: 'e2e-ask-user-task',
            tabId: targetTabId,
            options: { mode: 'act', tabIds: [targetTabId] },
          });
        }),
      tabId,
    );
    state.script = null;

    assert.equal(question?.question, 'Which plan?');
    assert.deepEqual(question?.options, ['Basic', 'Pro']);
    assert.ok(events.includes('system:task.ok'), `task did not complete after the answer: ${events.join(', ')}`);
    assert.deepEqual(pageErrors, []);
  });

  it('runs a scheduled act task from storage when run-now is sent', async () => {
    state.navigatorSteps = 0;
    state.script = null;
    const panel = await openExtensionPage('side-panel/index.html');
    await configureFakeLlm(panel, baseUrl);
    const scheduleId = 'e2e-schedule';
    const startUrl = `${baseUrl}/page`;
    // A daily schedule whose next run is far away, so only the explicit run-now can start it during the test.
    await panel.evaluate(
      ({ id, url }) =>
        chrome.storage.local.set({
          'scheduled-tasks': {
            tasks: [
              {
                id,
                name: 'Click the Go button',
                prompt: 'Click the Go button',
                mode: 'act',
                startUrl: url,
                enabled: true,
                frequency: 'daily',
                time: '09:00',
                date: null,
                weekday: 1,
                dayOfMonth: 1,
                nextRunAt: Date.now() + 86_400_000,
                createdAt: Date.now(),
                history: [],
              },
            ],
          },
        }),
      { id: scheduleId, url: startUrl },
    );

    const reply = await panel.evaluate(
      id => chrome.runtime.sendMessage({ type: 'qagent:schedule:run-now', id }),
      scheduleId,
    );
    assert.deepEqual(reply, { ok: true }, 'run-now did not reach the background');

    // Poll the stored run history until the background records the outcome.
    const readSchedule = () =>
      panel.evaluate(
        id =>
          chrome.storage.local
            .get('scheduled-tasks')
            .then(data => data['scheduled-tasks'].tasks.find(task => task.id === id)),
        scheduleId,
      );
    const deadline = Date.now() + 90_000;
    let schedule;
    while (Date.now() < deadline) {
      schedule = await readSchedule();
      if (schedule?.history?.length) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    assert.ok(schedule?.history?.length, 'scheduled run did not record a history entry');
    assert.equal(schedule.history.at(-1).outcome, 'completed', JSON.stringify(schedule.history));
    // The scheduler opens its own start tab, which is the most recent page on the target URL.
    const scheduledPage = context
      .pages()
      .filter(page => page.url() === startUrl)
      .at(-1);
    assert.ok(scheduledPage, 'scheduled start tab not found');
    assert.equal(await scheduledPage.locator('#status').textContent(), 'clicked');
    assert.deepEqual(pageErrors, []);
  });

  it('records a workflow from a real click and saves it as a shortcut', async () => {
    const target = await context.newPage();
    await target.goto(`${baseUrl}/record`);

    const panel = await openExtensionPage('side-panel/index.html');
    await panel.locator('#app-container > *').first().waitFor();

    // The panel records the tab that is active in its window, so bring the target forward before starting.
    await target.bringToFront();
    // The panel runs in pt_BR in this suite (see the takeover test), so the labels below are pt_BR.
    // A DOM click: a Playwright click would focus the panel tab, and the start uses the window's active tab.
    await panel.evaluate(() =>
      [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Gravar fluxo').click(),
    );
    await panel.getByText('Gravando fluxo', { exact: true }).waitFor();

    // Playwright clicks are trusted events; the content script records the click as a step.
    await target.click('#go');
    await panel.getByRole('list', { name: 'Passos gravados' }).getByText('Clicar em "Go"').waitFor();

    await panel.getByRole('button', { name: 'Parar', exact: true }).click();
    const procedure = panel.getByRole('textbox', { name: 'Procedimento (edite se quiser)' });
    await procedure.waitFor();
    assert.match(await procedure.inputValue(), /1\. Clicar em "Go"/);

    await panel.getByRole('textbox', { name: 'Nome do atalho' }).fill('E2E go flow');
    await panel.getByRole('button', { name: 'Salvar como atalho' }).click();
    await panel.getByText('Salvo. Digite /nome', { exact: false }).waitFor();

    const stored = await panel.evaluate(() => chrome.storage.local.get(null));
    assert.ok(JSON.stringify(stored).includes('E2E go flow'), 'saved shortcut was not written to storage');
    assert.deepEqual(pageErrors, []);
  });

  it('runs a browser plugin tool that the navigator calls with call_plugin_tool', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    // The scripted navigator lists the enabled plugins, calls the plugin tool, then finishes.
    state.script = [
      { list_plugins: { intent: 'list plugins' } },
      {
        call_plugin_tool: { intent: 'set title', plugin: 'E2E title', tool: 'set_title', args: { text: 'plugin ran' } },
      },
      { done: { text: 'Title set by the plugin', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/page`);
    const panel = await openExtensionPage('side-panel/index.html');
    await panel.evaluate(async () => {
      await chrome.storage.local.set({
        'browser-plugins': {
          plugins: [
            {
              id: 'e2e-title-plugin',
              name: 'E2E title',
              description: 'Sets the page title',
              version: '1.0.0',
              enabled: true,
              matches: [],
              instructions: '',
              tools: [
                {
                  name: 'set_title',
                  description: 'Set the document title',
                  parameters: { text: { type: 'string', required: true } },
                  code: 'document.title = args.text; return document.title;',
                },
              ],
              createdBy: 'user',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
      });
    });
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/page` })).at(-1)?.id,
      baseUrl,
    );
    assert.ok(tabId, 'target tab not found');

    const seen = await runTask(panel, tabId, 'Set the page title with the plugin', 'e2e-plugin-task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.ok(prompts[0]?.includes('E2E title'), 'the applicable plugin was not listed in the state message');
    assert.equal(await target.title(), 'plugin ran');
    await panel.evaluate(() => chrome.storage.local.remove('browser-plugins'));
    assert.deepEqual(pageErrors, []);
  });

  it('fills a controlled field over stale text and reads the page structure', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      { fill: { intent: 'fill name', target: { role: 'textbox', text: 'Name' }, text: 'Ada Lovelace' } },
      { page_info: { intent: 'read structure', max_per_kind: 5 } },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/ui`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/ui` })).at(-1)?.id,
      baseUrl,
    );
    assert.ok(tabId, 'ui tab not found');

    const seen = await runTask(panel, tabId, 'Fill the name field', 'e2e-fill-task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.equal(await target.locator('#echo').textContent(), 'Ada Lovelace', 'the page did not receive the fill');
    assert.equal(await target.inputValue('#name'), 'Ada Lovelace');
    // page_info is the second action, so its result arrives in the prompt after it: index 2.
    assert.ok(prompts[2]?.includes('Fields ('), 'page_info did not reach the model');
    assert.ok(prompts[2]?.includes('textbox'), 'the named field is missing from page_info');
    assert.deepEqual(pageErrors, []);
  });

  it('names the covering element, clears it, waits for a late button and reads progress', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      { click: { intent: 'click save while covered', target: { role: 'button', text: 'Save' } } },
      { click: { intent: 'dismiss the banner', target: { text: 'Accept' } } },
      { click: { intent: 'save', target: { role: 'button', text: 'Save' } } },
      {
        wait_for_element: {
          intent: 'wait for ready',
          target: { role: 'button', text: 'Ready' },
          state: 'visible',
          timeout_ms: 5000,
        },
      },
      { click: { intent: 'click ready', target: { text: 'Ready' } } },
      { find_progress: { intent: 'look for progress' } },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/ui`);
    const panel = await openExtensionPage('side-panel/index.html');
    // Earlier scenarios leave their /ui tabs open, so take the newest one.
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/ui` })).at(-1)?.id,
      baseUrl,
    );
    assert.ok(tabId, 'ui tab not found');

    const seen = await runTask(panel, tabId, 'Save, then press Ready', 'e2e-cover-task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    // The covered click reports its blocker in the next prompt, and nothing was clicked through the banner.
    assert.ok(prompts[1]?.includes('covered by div#banner'), 'covering element was not reported to the model');
    assert.equal(await target.locator('#status').textContent(), 'ready clicked');
    // find_progress is the sixth action, so its result is in the prompt after it: index 6.
    assert.ok(prompts[6]?.includes('progressbar') && prompts[6]?.includes('40%'), 'progress bar was not reported');
    assert.deepEqual(pageErrors, []);
  });

  it('lists frames and scopes the snapshot and a click to a cross-origin iframe', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      { switch_frame: { intent: 'list frames' } },
      { switch_frame: { intent: 'enter the frame', index: 1 } },
      { click: { intent: 'click inside the frame', target: { role: 'button', text: 'Inner go' } } },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/frame-host`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/frame-host` }))[0]?.id,
      baseUrl,
    );
    assert.ok(tabId, 'frame host tab not found');

    const seen = await runTask(panel, tabId, 'Click the button inside the frame', 'e2e-frame-task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.ok(prompts[1]?.includes('localhost'), 'frame list did not reach the model');
    assert.ok(prompts[2]?.includes('Inner go'), 'snapshot did not come from the focused frame');
    const inner = target.frames().find(frame => frame.url().includes('/inner'));
    assert.ok(inner, 'cross-origin frame not found');
    assert.equal(await inner.locator('#inner-go').textContent(), 'inner clicked');
    assert.deepEqual(pageErrors, []);
  });

  it('captures a full-page screenshot taller than the viewport', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      { screenshot: { intent: 'capture the page', full_page: true } },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/tall`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/tall` })).at(-1)?.id,
      baseUrl,
    );
    assert.ok(tabId, 'tall tab not found');

    const seen = await runTask(panel, tabId, 'Capture the whole page', 'e2e-shot-task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    // screenshot is the first action, so its result arrives in the second prompt; the capture is ~3000 px tall
    assert.match(prompts[1] ?? '', /\d+ x 3\d{3} px/, 'full-page capture height was not reported');
    assert.deepEqual(pageErrors, []);
  });

  it('captures a download link to completion and lists the saved file', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      {
        capture_download: {
          intent: 'download the csv',
          target: { role: 'link', text: 'Get CSV' },
          timeout_ms: 20000,
        },
      },
      { list_downloads: { intent: 'list downloads' } },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/download-page`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/download-page` })).at(-1)?.id,
      baseUrl,
    );
    assert.ok(tabId, 'download tab not found');

    const seen = await runTask(panel, tabId, 'Download the CSV report', 'e2e-download-task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.ok(seen.includes('navigator:act.ok'), 'capture_download did not finish ok');
    // Playwright renames downloads to GUID file names, so the URL is what identifies the file.
    assert.ok(prompts[2]?.includes('report-e2e.csv'), 'list_downloads did not list the captured file');
    assert.ok(prompts[2]?.includes('complete'), 'list_downloads did not report the download as complete');
    assert.deepEqual(pageErrors, []);
  });

  it('lists the WebMCP tools of a page and calls one with call_site_tool', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      { list_site_tools: { intent: 'list the site tools' } },
      { call_site_tool: { intent: 'add an item', name: 'add_item', args: { name: 'milk' } } },
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/site-tools`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/site-tools` })).at(-1)?.id,
      baseUrl,
    );
    assert.ok(tabId, 'site tools tab not found');

    const seen = await runTask(panel, tabId, 'Add milk with the page tool', 'e2e-webmcp-task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.ok(prompts[1]?.includes('add_item'), 'the page tool was not listed');
    assert.ok(prompts[2]?.includes('milk'), 'the page tool result did not reach the model');
    assert.deepEqual(pageErrors, []);
  });

  it('reports a text change on a watched element through a monitor', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      { start_monitor: { intent: 'watch the feed', selector: '#feed', timeout_minutes: 5 } },
      // The monitor id comes from the start_monitor result, which is in the prompt of this step.
      prompt => ({
        await_monitor: {
          intent: 'wait for the change',
          id: prompt.match(/mon-[a-z0-9]{6}/)?.[0] ?? '',
          timeout_ms: 15000,
        },
      }),
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/monitor`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/monitor` })).at(-1)?.id,
      baseUrl,
    );
    assert.ok(tabId, 'monitor tab not found');

    const seen = await runTask(panel, tabId, 'Tell me when the feed changes', 'e2e-monitor-task');
    const prompts = state.navigatorPrompts;
    state.script = null;

    assert.ok(seen.includes('system:task.ok'), `task did not finish ok: ${seen.join(', ')}`);
    assert.ok(prompts[2]?.includes('[changed]'), 'the monitor did not report the change');
    assert.ok(prompts[2]?.includes('v2'), 'the changed text was not reported');
    assert.deepEqual(pageErrors, []);
  });
});
