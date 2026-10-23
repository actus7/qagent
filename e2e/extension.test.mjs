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
// A purchase button: the sensitive-action classifier must ask about it even in auto mode.
const CHECKOUT_PAGE = `<!doctype html><title>Checkout target</title><h1 id="status">idle</h1>
<button id="buy" onclick="document.getElementById('status').textContent='bought'">Comprar agora</button>`;
// Index of the "Go" button in the snapshot the navigator receives.
const goButtonIndex = prompt => Number(prompt.match(/\[(\d+)\](?:\[ref=e\d+\])?<button[^>]*>Go \/>/)?.[1]);
// Index of a button with the given label in the snapshot the navigator receives.
const buttonIndex = (prompt, label) =>
  Number(prompt.match(new RegExp(`\\[(\\d+)\\](?:\\[ref=e\\d+\\])?<button[^>]*>${label} />`))?.[1]);

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
        if (req.url.startsWith('/missing-api')) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          return res.end('not found');
        }
        res.writeHead(200, { 'content-type': 'text/html' });
        if (req.url.startsWith('/telemetry')) return res.end(TELEMETRY_PAGE);
        if (req.url.startsWith('/pointer')) return res.end(POINTER_PAGE);
        if (req.url.startsWith('/checkout')) return res.end(CHECKOUT_PAGE);
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
            // upload_file is sensitive: it asks even in auto mode, so approve it once.
            if (message.type === 'approval_required') {
              port.postMessage({
                type: 'approval_result',
                taskId: message.request.taskId,
                requestId: message.request.id,
                approved: true,
                decision: 'once',
              });
              return;
            }
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
            options: { mode: 'act', permissionMode: 'auto', tabIds: [targetTabId] },
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
            // upload_file is sensitive: it asks even in auto mode, so approve it once.
            if (message.type === 'approval_required') {
              port.postMessage({
                type: 'approval_result',
                taskId: message.request.taskId,
                requestId: message.request.id,
                approved: true,
                decision: 'once',
              });
              return;
            }
            if (message.type !== 'execution') return;
            events.push(`${message.actor}:${message.state}`);
            if (['task.ok', 'task.fail', 'task.cancel'].includes(message.state)) resolve(events);
          });
          port.postMessage({
            type: 'new_task',
            task: 'Attach the PDF',
            taskId: 'e2e-upload-binary-task',
            tabId: targetTabId,
            options: { mode: 'act', permissionMode: 'auto', tabIds: [targetTabId] },
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

  // Runs one task and answers every approval_required with `decision`; resolves with the states and asked actions.
  function runTaskWithApprovals(panel, targetTabId, { task, taskId, mode, permissionMode, decision }) {
    return panel.evaluate(
      ({ targetTabId, task, taskId, mode, permissionMode, decision }) =>
        new Promise(resolve => {
          const events = [];
          const approvals = [];
          const port = chrome.runtime.connect({ name: 'side-panel-connection' });
          setTimeout(() => resolve({ events, approvals }), 120_000);
          port.onMessage.addListener(message => {
            if (message.type === 'approval_required') {
              approvals.push(message.request.action);
              port.postMessage({
                type: 'approval_result',
                taskId: message.request.taskId,
                requestId: message.request.id,
                approved: decision !== 'deny',
                decision,
              });
              return;
            }
            if (message.type !== 'execution') return;
            events.push(`${message.actor}:${message.state}`);
            if (['task.ok', 'task.fail', 'task.cancel'].includes(message.state)) resolve({ events, approvals });
          });
          port.postMessage({
            type: 'new_task',
            task,
            taskId,
            tabId: targetTabId,
            options: { mode, permissionMode, tabIds: [targetTabId] },
          });
        }),
      { targetTabId, task, taskId, mode, permissionMode, decision },
    );
  }

  it('asks once in ask mode, then "always allow this site" skips the prompt for later clicks', async () => {
    state.navigatorSteps = 0;
    state.navigatorPrompts = [];
    state.script = [
      prompt => ({ click_element: { intent: 'first click', index: goButtonIndex(prompt) } }),
      prompt => ({ click_element: { intent: 'second click', index: goButtonIndex(prompt) } }),
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/ask`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(async url => (await chrome.tabs.query({ url: `${url}/ask` }))[0]?.id, baseUrl);
    assert.ok(tabId, 'ask tab not found');

    const { events, approvals } = await runTaskWithApprovals(panel, tabId, {
      task: 'Click the Go button twice',
      taskId: 'e2e-always-site-task',
      mode: 'act',
      permissionMode: 'ask',
      decision: 'always_site',
    });
    state.script = null;

    assert.ok(events.includes('system:task.ok'), `task did not finish ok: ${events.join(', ')}`);
    assert.deepEqual(approvals, ['click_element'], 'the second click must not ask again');
    assert.equal(await target.locator('#status').textContent(), 'clicked');

    // Forget the site again so later tests start from the default ask behaviour.
    await panel.evaluate(() => chrome.storage.local.set({ 'site-permissions': { allowedOrigins: [] } }));
    assert.deepEqual(pageErrors, []);
  });

  it('asks before a purchase button even in auto mode', async () => {
    state.navigatorSteps = 0;
    state.script = [
      prompt => ({ click_element: { intent: 'buy now', index: buttonIndex(prompt, 'Comprar agora') } }),
      { done: { text: 'done', success: true } },
    ];
    const target = await context.newPage();
    await target.goto(`${baseUrl}/checkout`);
    const panel = await openExtensionPage('side-panel/index.html');
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url: `${url}/checkout` }))[0]?.id,
      baseUrl,
    );
    assert.ok(tabId, 'checkout tab not found');

    const { events, approvals } = await runTaskWithApprovals(panel, tabId, {
      task: 'Buy it now',
      taskId: 'e2e-purchase-task',
      mode: 'act',
      permissionMode: 'auto',
      decision: 'once',
    });
    state.script = null;

    assert.ok(events.includes('system:task.ok'), `task did not finish ok: ${events.join(', ')}`);
    assert.equal(approvals.length, 1, 'the purchase click did not ask for approval');
    assert.equal(await target.locator('#status').textContent(), 'bought');
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
            options: { mode: 'act', permissionMode: 'auto', tabIds: [targetTabId] },
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
                // Unattended run: no panel answers approvals, so the schedule opts in to acting on its own.
                permissionMode: 'auto',
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
    await panel.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Gravar fluxo').click());
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
});
