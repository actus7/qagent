// Builds a self-contained session report (HTML or Markdown) from chat messages and stored step history.
// Every string taken from the chat or the pages is untrusted: HTML output is escaped and contains no script.

export interface ReportMessage {
  actor: string;
  content: string;
  timestamp: number;
  kind?: string;
}

export interface ReportAction {
  name: string;
  intent: string;
  result: string;
  error: string | null;
}

export interface ReportStep {
  index: number;
  url: string;
  title: string;
  actions: ReportAction[];
}

export interface ReportLabels {
  title: string;
  generatedAt: string;
  models: string;
  noModels: string;
  messages: string;
  finalAnswer: string;
  noFinalAnswer: string;
  steps: string;
  noSteps: string;
  step: string;
  intent: string;
  result: string;
  error: string;
  compacted: string;
  you: string;
  assistant: string;
  system: string;
}

export interface SessionReportInput {
  title: string;
  generatedAt: number;
  models: string[];
  messages: ReportMessage[];
  /** Steps of the last task, when replay history was stored for the session. */
  steps: ReportStep[];
  labels: ReportLabels;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function parseModelActions(modelOutput: unknown): { name: string; intent: string }[] {
  if (typeof modelOutput !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(modelOutput);
  } catch {
    return [];
  }
  const actions = isRecord(parsed) && Array.isArray(parsed.action) ? parsed.action : [];
  return actions.flatMap(item => {
    if (!isRecord(item)) return [];
    const [name, value] = Object.entries(item)[0] ?? [];
    if (!name) return [];
    return [{ name, intent: isRecord(value) ? text(value.intent) : '' }];
  });
}

function toReportStep(record: unknown, index: number): ReportStep {
  const source = isRecord(record) ? record : {};
  const state = isRecord(source.state) ? source.state : {};
  const results = Array.isArray(source.result) ? source.result : [];
  const modelActions = parseModelActions(source.modelOutput);
  const actions = results.map((result, position) => {
    const entry = isRecord(result) ? result : {};
    const planned = modelActions[position];
    return {
      name: planned?.name ?? 'action',
      intent: planned?.intent ?? '',
      result: text(entry.extractedContent),
      error: typeof entry.error === 'string' && entry.error ? entry.error : null,
    };
  });
  return { index, url: text(state.url), title: text(state.title), actions };
}

/** Reads the replay-format agent history JSON. Unreadable input yields no steps instead of an error. */
export function parseAgentStepHistory(raw: string): ReportStep[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const records = isRecord(parsed) && Array.isArray(parsed.history) ? parsed.history : [];
  return records.map((record, position) => toReportStep(record, position + 1));
}

const formatTime = (timestamp: number): string => new Date(timestamp).toISOString();

function finalAnswerOf(messages: ReportMessage[]): string | null {
  const answers = messages.filter(message => message.actor === 'assistant' && message.kind === 'answer');
  return answers.length > 0 ? answers[answers.length - 1].content : null;
}

function speakerOf(message: ReportMessage, labels: ReportLabels): string {
  if (message.actor === 'user') return labels.you;
  if (message.actor === 'assistant') return labels.assistant;
  return labels.system;
}

const STYLE = `
body{font-family:system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1f2933;line-height:1.5}
h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #d9e2ec;padding-bottom:4px}
.meta{color:#52606d;font-size:13px}.msg{border-left:3px solid #9aa5b1;padding:6px 12px;margin:10px 0}
.msg.user{border-color:#3e7bfa}.msg.assistant{border-color:#2f9e6b}.msg.system{border-color:#b7791f}
.who{font-size:12px;color:#52606d;font-weight:600}.body{white-space:pre-wrap;word-break:break-word}
.step{background:#f5f7fa;border-radius:6px;padding:8px 12px;margin:10px 0}
.action{margin:6px 0 0 12px}.error{color:#b42318}.url{font-size:12px;color:#52606d;word-break:break-all}
`;

function htmlMessage(message: ReportMessage, labels: ReportLabels): string {
  if (message.kind === 'compaction') {
    return `<p class="meta">${escapeHtml(labels.compacted)} (${escapeHtml(formatTime(message.timestamp))})</p>`;
  }
  const role = message.actor === 'user' ? 'user' : message.actor === 'assistant' ? 'assistant' : 'system';
  return [
    `<div class="msg ${role}">`,
    `<div class="who">${escapeHtml(speakerOf(message, labels))} · ${escapeHtml(formatTime(message.timestamp))}</div>`,
    `<div class="body">${escapeHtml(message.content)}</div>`,
    '</div>',
  ].join('');
}

function htmlStep(step: ReportStep, labels: ReportLabels): string {
  const actions = step.actions.map(
    action =>
      `<div class="action"><strong>${escapeHtml(action.name)}</strong>` +
      (action.intent ? ` · ${escapeHtml(labels.intent)}: ${escapeHtml(action.intent)}` : '') +
      (action.result ? `<div class="body">${escapeHtml(labels.result)}: ${escapeHtml(action.result)}</div>` : '') +
      (action.error ? `<div class="body error">${escapeHtml(labels.error)}: ${escapeHtml(action.error)}</div>` : '') +
      '</div>',
  );
  return [
    `<div class="step"><strong>${escapeHtml(labels.step)} ${step.index}</strong>`,
    `<div class="url">${escapeHtml(step.title)} ${escapeHtml(step.url)}</div>`,
    ...actions,
    '</div>',
  ].join('');
}

/** Returns a complete HTML document. All dynamic values pass through escapeHtml; the document has no script. */
export function buildSessionReportHtml(input: SessionReportInput): string {
  const { labels } = input;
  const answer = finalAnswerOf(input.messages);
  const models = input.models.length > 0 ? input.models.map(escapeHtml).join(', ') : escapeHtml(labels.noModels);
  const steps =
    input.steps.length > 0 ? input.steps.map(step => htmlStep(step, labels)).join('') : `<p>${escapeHtml(labels.noSteps)}</p>`;
  return [
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title><style>${STYLE}</style></head><body>`,
    `<h1>${escapeHtml(input.title)}</h1>`,
    `<p class="meta">${escapeHtml(labels.generatedAt)}: ${escapeHtml(formatTime(input.generatedAt))}<br>`,
    `${escapeHtml(labels.models)}: ${models}</p>`,
    `<h2>${escapeHtml(labels.finalAnswer)}</h2>`,
    `<div class="body">${answer === null ? escapeHtml(labels.noFinalAnswer) : escapeHtml(answer)}</div>`,
    `<h2>${escapeHtml(labels.steps)}</h2>${steps}`,
    `<h2>${escapeHtml(labels.messages)}</h2>${input.messages.map(message => htmlMessage(message, labels)).join('')}`,
    '</body></html>',
  ].join('\n');
}

function markdownSteps(steps: ReportStep[], labels: ReportLabels): string[] {
  if (steps.length === 0) return [labels.noSteps, ''];
  return steps.flatMap(step => [
    `### ${labels.step} ${step.index}`,
    step.url ? `${step.title} <${step.url}>` : step.title,
    '',
    ...step.actions.flatMap(action => [
      `- **${action.name}**${action.intent ? ` (${labels.intent}: ${action.intent})` : ''}`,
      ...(action.result ? [`  ${labels.result}: ${action.result.replace(/\n/g, '\n  ')}`] : []),
      ...(action.error ? [`  ${labels.error}: ${action.error.replace(/\n/g, '\n  ')}`] : []),
    ]),
    '',
  ]);
}

/**
 * Returns the report as Markdown. Page-derived text is shown in fenced blocks so it cannot
 * start Markdown structure (headings, links, HTML) in the exported file.
 */
export function buildSessionReportMarkdown(input: SessionReportInput): string {
  const { labels } = input;
  const answer = finalAnswerOf(input.messages);
  const lines = [
    `# ${input.title}`,
    '',
    `${labels.generatedAt}: ${formatTime(input.generatedAt)}  `,
    `${labels.models}: ${input.models.length > 0 ? input.models.join(', ') : labels.noModels}`,
    '',
    `## ${labels.finalAnswer}`,
    '',
    answer === null ? labels.noFinalAnswer : fenced(answer),
    '',
    `## ${labels.steps}`,
    '',
    ...markdownSteps(input.steps, labels),
    `## ${labels.messages}`,
    '',
  ];
  for (const message of input.messages) {
    if (message.kind === 'compaction') {
      lines.push(`_${labels.compacted} (${formatTime(message.timestamp)})_`, '');
      continue;
    }
    lines.push(`**${speakerOf(message, labels)}** · ${formatTime(message.timestamp)}`, '', fenced(message.content), '');
  }
  return lines.join('\n');
}

function fenced(content: string): string {
  // A fence longer than any backtick run in the content keeps the block closed.
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map(run => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${content}\n${fence}`;
}
