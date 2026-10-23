import { useState } from 'react';
import { scheduledTasksStore, SCHEDULE_LIMIT, type ScheduleMode } from '@extension/storage';
import {
  createScheduleDraft,
  scheduleFromDraft,
  SCHEDULE_PROMPT_MAX_LENGTH,
  validateScheduleDraft,
  type ScheduleDraft,
  type ScheduleDraftErrors,
} from '@extension/shared';
import { t } from '@extension/i18n';
import { FiX } from 'react-icons/fi';
import { Button } from '@src/components/ui/button';
import { Card } from '@src/components/ui/card';

interface ScheduleDialogProps {
  initialPrompt: string;
  initialMode: ScheduleMode;
  /** URL of the selected tab; prefilled as the start URL. */
  initialStartUrl: string;
  onClose: () => void;
  /** Called after the schedule is stored, with its first run time. */
  onSaved: (nextRunAt: number) => void;
}

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden';
const MODES: ScheduleMode[] = ['act', 'plan', 'chat'];

const firstError = (errors: ScheduleDraftErrors): string | null => {
  const code = errors.prompt ?? errors.startUrl ?? errors.time ?? errors.date;
  return code ? t(`options_schedule_error_${code}`) : null;
};

/** Compact schedule form for the side panel. Weekly and monthly schedules are edited in the options page. */
export default function ScheduleDialog({
  initialPrompt,
  initialMode,
  initialStartUrl,
  onClose,
  onSaved,
}: ScheduleDialogProps) {
  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    createScheduleDraft(new Date(), {
      prompt: initialPrompt,
      mode: initialMode,
      startUrl: initialStartUrl,
      frequency: 'daily',
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const nowMs = Date.now();
    const { errors, nextRunAt } = validateScheduleDraft(draft, nowMs);
    const message = firstError(errors);
    if (message || nextRunAt === null) {
      setError(message ?? t('options_schedule_error_dateInPast'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if ((await scheduledTasksStore.getTasks()).length >= SCHEDULE_LIMIT) {
        setError(t('options_schedule_error_limit', [String(SCHEDULE_LIMIT)]));
        return;
      }
      const task = scheduleFromDraft(draft, { id: crypto.randomUUID(), nowMs });
      if (!task) return;
      await scheduledTasksStore.saveTask(task);
      onSaved(nextRunAt);
    } catch (saveError) {
      console.error('Failed to save scheduled task:', saveError);
      setError(t('options_schedule_error_saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
      <Card className="max-h-[90%] w-[92%] max-w-sm space-y-3 overflow-y-auto border-border bg-background p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('chat_schedule_title')}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="size-8"
            aria-label={t('chat_schedule_cancel')}>
            <FiX className="size-5" />
          </Button>
        </div>

        <div className="space-y-1">
          <label htmlFor="schedule-dialog-prompt" className="text-xs font-medium">
            {t('options_schedule_field_prompt')}
          </label>
          <textarea
            id="schedule-dialog-prompt"
            rows={3}
            maxLength={SCHEDULE_PROMPT_MAX_LENGTH}
            value={draft.prompt}
            onChange={e => update('prompt', e.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="schedule-dialog-mode" className="text-xs font-medium">
              {t('options_schedule_field_mode')}
            </label>
            <select
              id="schedule-dialog-mode"
              value={draft.mode}
              onChange={e => update('mode', e.target.value as ScheduleMode)}
              className={INPUT_CLASS}>
              {MODES.map(mode => (
                <option key={mode} value={mode}>
                  {t(`options_schedule_mode_${mode}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="schedule-dialog-frequency" className="text-xs font-medium">
              {t('options_schedule_field_frequency')}
            </label>
            <select
              id="schedule-dialog-frequency"
              value={draft.frequency}
              onChange={e => update('frequency', e.target.value === 'once' ? 'once' : 'daily')}
              className={INPUT_CLASS}>
              <option value="daily">{t('options_schedule_freq_daily')}</option>
              <option value="once">{t('options_schedule_freq_once')}</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="schedule-dialog-url" className="text-xs font-medium">
            {t('options_schedule_field_startUrl')}
          </label>
          <input
            id="schedule-dialog-url"
            type="url"
            value={draft.startUrl}
            onChange={e => update('startUrl', e.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {draft.frequency === 'once' ? (
            <div className="space-y-1">
              <label htmlFor="schedule-dialog-date" className="text-xs font-medium">
                {t('options_schedule_field_date')}
              </label>
              <input
                id="schedule-dialog-date"
                type="date"
                value={draft.date}
                onChange={e => update('date', e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <label htmlFor="schedule-dialog-time" className="text-xs font-medium">
              {t('options_schedule_field_time')}
            </label>
            <input
              id="schedule-dialog-time"
              type="time"
              value={draft.time}
              onChange={e => update('time', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={draft.autoApprove}
            onChange={e => update('autoApprove', e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>
            {t('options_schedule_field_autoApprove')}
            <span className="block text-muted-foreground">{t('options_schedule_autoNote')}</span>
          </span>
        </label>

        <p className="text-xs text-muted-foreground">{t('chat_schedule_moreInOptions')}</p>
        <button
          type="button"
          onClick={() => void chrome.runtime.openOptionsPage()}
          className="text-xs text-primary underline-offset-2 hover:underline">
          {t('chat_schedule_openOptions')}
        </button>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('chat_schedule_cancel')}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
            {t('chat_schedule_save')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
