import { agentModelStore, chatHistoryStore } from '@extension/storage';
import { t } from '@extension/i18n';
import {
  buildSessionReportHtml,
  buildSessionReportMarkdown,
  parseAgentStepHistory,
  type ReportLabels,
  type SessionReportInput,
} from '@extension/shared';

export type ReportFormat = 'html' | 'markdown';

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
});

/** Builds the report for a chat session. Steps come from the stored history of its last task, when one was kept. */
export async function buildSessionReport(sessionId: string, format: ReportFormat): Promise<string> {
  const session = await chatHistoryStore.getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const [stored, models] = await Promise.all([
    chatHistoryStore.loadAgentStepHistory(sessionId),
    agentModelStore.getAllAgentModels(),
  ]);
  const input: SessionReportInput = {
    title: session.title,
    generatedAt: Date.now(),
    models: Object.values(models).map(model => `${model.provider}/${model.modelName}`),
    messages: session.messages,
    steps: stored ? parseAgentStepHistory(stored.history) : [],
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
