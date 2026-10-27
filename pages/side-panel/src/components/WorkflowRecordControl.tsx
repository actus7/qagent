import { useEffect, useState } from 'react';
import { FiCircle, FiSquare, FiTrash2 } from 'react-icons/fi';
import { t } from '@extension/i18n';
import {
  buildProcedureText,
  describeStep,
  MAX_NAME_CHARS,
  type ProcedureLabels,
  type RecordedStep,
  type SidePanelCommandMessage,
} from '@extension/shared';
import favoritesStorage from '@extension/storage/lib/prompt/favorites';
import { Button } from '@extension/ui';
import { Input } from '@src/components/ui/input';
import { Textarea } from '@src/components/ui/textarea';
import { useWorkflowRecordingSnapshot } from '@src/store/workflowRecordingStore';

interface WorkflowRecordControlProps {
  sendMessage: (message: SidePanelCommandMessage) => void;
  /** The port opens lazily; this makes sure it exists before a command is sent. */
  ensureConnection: () => void;
}

function buildLabels(): ProcedureLabels {
  return {
    navigate: url => t('chat_record_step_navigate', [url]),
    click: name => t('chat_record_step_click', [name]),
    type: (field, value) => t('chat_record_step_type', [field, value]),
    select: (field, value) => t('chat_record_step_select', [field, value]),
    press: (field, key) => t('chat_record_step_press', [field, key]),
    submit: name => t('chat_record_step_submit', [name]),
    unnamed: t('chat_record_step_unnamed'),
  };
}

/** "Gravar fluxo": start on the active tab, live steps, stop, then review and save as a saved prompt. */
export default function WorkflowRecordControl({ sendMessage, ensureConnection }: WorkflowRecordControlProps) {
  const snapshot = useWorkflowRecordingSnapshot();
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [shortcutName, setShortcutName] = useState('');
  // null until the user edits it, so steps flushed after stop still show up in the review text
  const [procedureDraft, setProcedureDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isRecording = snapshot.status === 'recording';
  const isStopped = snapshot.status === 'stopped';

  // The panel may open after recording started; ask the background for the current state once.
  useEffect(() => {
    ensureConnection();
    try {
      sendMessage({ type: 'workflow_record_status' });
    } catch {
      // The connection is still opening; the next snapshot arrives once the background publishes one.
    }
  }, [ensureConnection, sendMessage]);

  const send = (message: SidePanelCommandMessage): boolean => {
    try {
      ensureConnection();
      sendMessage(message);
      return true;
    } catch {
      setNotice(t('chat_record_saveFailed'));
      return false;
    }
  };

  const handleStart = async () => {
    setNotice(null);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setNotice(t('chat_record_noTab'));
      return;
    }
    send({ type: 'workflow_record_start', tabId: tab.id });
  };

  const procedure = procedureDraft ?? buildProcedureText(snapshot.steps, buildLabels());

  // The review renders only once the background reports the stopped snapshot
  const openReview = () => {
    setShortcutName(t('chat_record_nameDefault'));
    setProcedureDraft(null);
    setIsReviewOpen(true);
  };

  const handleStop = () => {
    if (send({ type: 'workflow_record_stop' })) openReview();
  };

  const handleDiscard = () => {
    send({ type: 'workflow_record_discard' });
    setIsReviewOpen(false);
    setNotice(null);
  };

  const handleSave = async () => {
    const content = procedure.trim();
    if (!content) return;
    const title = shortcutName.trim().slice(0, MAX_NAME_CHARS) || t('chat_record_nameDefault');
    try {
      await favoritesStorage.addPrompt(title, content);
    } catch {
      setNotice(t('chat_record_saveFailed'));
      return;
    }
    // The background builds the workflow from the steps before the discard below clears them.
    send({ type: 'workflow_record_build', name: title });
    send({ type: 'workflow_record_discard' });
    setIsReviewOpen(false);
    setNotice(t('chat_record_saved'));
  };

  return (
    <section className="mx-3 mt-2 flex flex-col gap-2 text-sm" aria-label={t('chat_record_start')}>
      {!isRecording && !isStopped && (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => void handleStart()}>
            <FiCircle aria-hidden="true" size={10} className="text-red-500" />
            {t('chat_record_start')}
          </Button>
          {notice && (
            <span role="status" className="text-xs text-muted-foreground">
              {notice}
            </span>
          )}
        </div>
      )}

      {isRecording && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              <span
                aria-hidden="true"
                className="size-2 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none"
              />
              {t('chat_record_recording')}
            </span>
            <div className="flex gap-1">
              <Button type="button" variant="secondary" size="sm" onClick={handleStop}>
                <FiSquare aria-hidden="true" size={12} />
                {t('chat_record_stop')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleDiscard}
                aria-label={t('chat_record_discard')}
                title={t('chat_record_discard')}>
                <FiTrash2 aria-hidden="true" size={14} />
              </Button>
            </div>
          </div>
          <StepList steps={snapshot.steps} truncated={snapshot.truncated} />
        </div>
      )}

      {isStopped && !isReviewOpen && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2">
          <StepCount count={snapshot.steps.length} />
          <div className="flex gap-1">
            <Button type="button" variant="default" size="sm" onClick={openReview}>
              {t('chat_record_dialogTitle')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleDiscard}
              aria-label={t('chat_record_discard')}
              title={t('chat_record_discard')}>
              <FiTrash2 aria-hidden="true" size={14} />
            </Button>
          </div>
        </div>
      )}

      {isStopped && isReviewOpen && (
        <form
          className="flex flex-col gap-2 rounded-md border border-border bg-card p-2"
          aria-labelledby="workflow-record-review-title"
          onSubmit={event => {
            event.preventDefault();
            void handleSave();
          }}>
          <h3 id="workflow-record-review-title" className="font-medium">
            {t('chat_record_dialogTitle')}
          </h3>
          <label className="flex flex-col gap-1 text-xs">
            {t('chat_record_nameLabel')}
            <Input value={shortcutName} maxLength={MAX_NAME_CHARS} onChange={e => setShortcutName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('chat_record_procedureLabel')}
            <Textarea value={procedure} rows={6} className="text-sm" onChange={e => setProcedureDraft(e.target.value)} />
          </label>
          <StepList steps={snapshot.steps} truncated={snapshot.truncated} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsReviewOpen(false)}>
              {t('chat_record_close')}
            </Button>
            <Button type="submit" size="sm" disabled={!procedure.trim()}>
              {t('chat_record_save')}
            </Button>
          </div>
        </form>
      )}

      {notice && (isRecording || isStopped) && (
        <span role="status" className="text-xs text-muted-foreground">
          {notice}
        </span>
      )}
    </section>
  );
}

function StepCount({ count }: { count: number }) {
  return (
    <span className="text-xs text-muted-foreground">
      {t('chat_record_stepsLabel')}: {count}
    </span>
  );
}

/** The live list is a polite live region, so screen readers announce each new step without interrupting. */
function StepList({ steps, truncated }: { steps: RecordedStep[]; truncated: boolean }) {
  const labels = buildLabels();
  if (steps.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('chat_record_empty')}</p>;
  }
  return (
    <>
      <ol
        aria-label={t('chat_record_stepsLabel')}
        aria-live="polite"
        className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {steps.map((step, index) => (
          <li key={`${step.kind}-${step.at}`} className="text-xs">
            {index + 1}. {describeStep(step, labels)}
          </li>
        ))}
      </ol>
      {truncated && <p className="text-xs text-amber-600">{t('chat_record_truncated')}</p>}
    </>
  );
}
