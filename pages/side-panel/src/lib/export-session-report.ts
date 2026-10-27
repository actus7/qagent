import { agentModelStore, chatHistoryStore } from '@extension/storage';
import { t } from '@extension/i18n';
import {
  attachStepScreenshots,
  buildSessionReportHtml,
  buildSessionReportMarkdown,
  parseAgentStepHistory,
  type ReportLabels,
  type SessionReportInput,
  type StepScreenshot,
} from '@extension/shared';

type ReportFormat = 'html' | 'markdown';

const reportLabels = (): ReportLabels => ({
  title: t('report_exportHtml_a11y'),
  generatedAt: t('report_generatedAt'),
  models: t('report_models'),
  noModels: t('report_noModels'),
  messages: t('report_messages'),
  finalAnswer: t('report_finalAnswer'),
  noFinalAnswer: t('report_noFinalAnswer'),
  steps: t('report_steps'),
  noSteps: t('report_noSteps'),
  step: t('report_step'),
  intent: t('report_intent'),
  result: t('report_result'),
  error: t('report_error'),
  compacted: t('report_compacted'),
  you: t('report_you'),
  assistant: t('report_assistant'),
  system: t('report_system'),
  screenshot: t('report_screenshot'),
  screenshotHtmlOnly: t('report_screenshotHtmlOnly'),
});

/** Screenshots live in the background session store; a missing or failed read just leaves the report without them. */
async function fetchStepScreenshots(taskId: string): Promise<StepScreenshot[]> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'qagent:step-screenshots:get', taskId })) as
      { screenshots?: unknown } | undefined;
    return Array.isArray(response?.screenshots) ? (response.screenshots as StepScreenshot[]) : [];
  } catch (error) {
    console.error('Failed to load step screenshots:', error);
    return [];
  }
}

/** Builds the report for a chat session. Steps come from the stored history of its last task, when one was kept. */
async function buildSessionReport(sessionId: string, format: ReportFormat): Promise<string> {
  const session = await chatHistoryStore.getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const [stored, models, screenshots] = await Promise.all([
    chatHistoryStore.loadAgentStepHistory(sessionId),
    agentModelStore.getAllAgentModels(),
    fetchStepScreenshots(sessionId),
  ]);
  const input: SessionReportInput = {
    title: session.title,
    generatedAt: Date.now(),
    models: Object.values(models).map(model => `${model.provider}/${model.modelName}`),
    messages: session.messages,
    steps: stored ? attachStepScreenshots(parseAgentStepHistory(stored.history), screenshots) : [],
    labels: reportLabels(),
  };
  return format === 'html' ? buildSessionReportHtml(input) : buildSessionReportMarkdown(input);
}

/** Downloads the report with a Blob and a temporary link; chrome.downloads is not used. */
export async function exportSessionReport(sessionId: string, format: ReportFormat): Promise<void> {
  const content = await buildSessionReport(sessionId, format);
  const mimeType = format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8';
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `qagent-report-${sessionId}.${format === 'html' ? 'html' : 'md'}`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
