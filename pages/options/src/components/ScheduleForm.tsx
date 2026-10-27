import { useState } from 'react';
import {
  scheduledTasksStore,
  SCHEDULE_LIMIT,
  type ScheduledTask,
  type ScheduleFrequency,
  type ScheduleMode,
} from '@extension/storage';
import {
  createScheduleDraft,
  draftFromTask,
  scheduleFromDraft,
  SCHEDULE_PROMPT_MAX_LENGTH,
  validateScheduleDraft,
  type ScheduleDraft,
  type ScheduleDraftErrors,
} from '@extension/shared';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';

interface ScheduleFormProps {
  /** The schedule being edited; null creates a new one. */
  task: ScheduledTask | null;
  taskCount: number;
  onDone: () => void;
}

const FREQUENCIES: ScheduleFrequency[] = ['once', 'daily', 'weekly', 'monthly'];
const MODES: ScheduleMode[] = ['act', 'plan', 'chat'];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, index) => index + 1);
const INPUT_CLASS = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground';

/** Localized weekday name. Literal keys keep the typed i18n lookup happy. */
export const weekdayLabel = (day: number): string => {
  switch (day) {
    case 0:
      return t('options_schedule_weekday_0');
    case 1:
      return t('options_schedule_weekday_1');
    case 2:
      return t('options_schedule_weekday_2');
    case 3:
      return t('options_schedule_weekday_3');
    case 4:
      return t('options_schedule_weekday_4');
    case 5:
      return t('options_schedule_weekday_5');
    default:
      return t('options_schedule_weekday_6');
  }
};

const errorText = (errors: ScheduleDraftErrors, field: keyof ScheduleDraftErrors): string | null => {
  const code = errors[field];
  return code ? t(`options_schedule_error_${code}`) : null;
};

export const ScheduleForm = ({ task, taskCount, onDone }: ScheduleFormProps) => {
  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    task ? draftFromTask(task) : createScheduleDraft(new Date()),
  );
  const [errors, setErrors] = useState<ScheduleDraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const nowMs = Date.now();
    const { errors: found } = validateScheduleDraft(draft, nowMs);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    if (!task && taskCount >= SCHEDULE_LIMIT) {
      setFormError(t('options_schedule_error_limit', [String(SCHEDULE_LIMIT)]));
      return;
    }
    const stored = scheduleFromDraft(draft, {
      id: task?.id ?? crypto.randomUUID(),
      nowMs,
      existing: task ?? undefined,
    });
    if (!stored) return;
    setSaving(true);
    try {
      await scheduledTasksStore.saveTask(stored);
      onDone();
    } catch (error) {
      console.error('Failed to save scheduled task:', error);
      // The store refuses a new task past the limit; report that instead of a generic failure.
      const isFull = (await scheduledTasksStore.getTasks().catch(() => [])).length >= SCHEDULE_LIMIT;
      setFormError(
        !task && isFull
          ? t('options_schedule_error_limit', [String(SCHEDULE_LIMIT)])
          : t('options_schedule_error_saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const promptError = errorText(errors, 'prompt');
  const urlError = errorText(errors, 'startUrl');
  const timeError = errorText(errors, 'time');
  const dateError = errorText(errors, 'date');

  return (
    <div className="rounded-lg border border-border bg-card p-6 text-left shadow-xs">
      <h2 className="mb-4 text-xl font-semibold text-foreground">
        {task ? t('options_schedule_formEdit') : t('options_schedule_formNew')}
      </h2>

      <div className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="schedule-prompt" className="text-sm font-medium text-foreground">
            {t('options_schedule_field_prompt')}
          </label>
          <textarea
            id="schedule-prompt"
            rows={3}
            maxLength={SCHEDULE_PROMPT_MAX_LENGTH}
            value={draft.prompt}
            onChange={e => update('prompt', e.target.value)}
            placeholder={t('options_schedule_field_prompt_hint')}
            className={INPUT_CLASS}
          />
          {promptError ? <p className="text-xs text-destructive">{promptError}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="schedule-mode" className="text-sm font-medium text-foreground">
              {t('options_schedule_field_mode')}
            </label>
            <select
              id="schedule-mode"
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
          <div className="space-y-2">
            <label htmlFor="schedule-frequency" className="text-sm font-medium text-foreground">
              {t('options_schedule_field_frequency')}
            </label>
            <select
              id="schedule-frequency"
              value={draft.frequency}
              onChange={e => update('frequency', e.target.value as ScheduleFrequency)}
              className={INPUT_CLASS}>
              {FREQUENCIES.map(frequency => (
                <option key={frequency} value={frequency}>
                  {t(`options_schedule_freq_${frequency}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="schedule-url" className="text-sm font-medium text-foreground">
            {t('options_schedule_field_startUrl')}
          </label>
          <input
            id="schedule-url"
            type="url"
            value={draft.startUrl}
            onChange={e => update('startUrl', e.target.value)}
            placeholder="https://"
            className={INPUT_CLASS}
          />
          <p className="text-xs text-muted-foreground">{t('options_schedule_field_startUrl_hint')}</p>
          {urlError ? <p className="text-xs text-destructive">{urlError}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {draft.frequency === 'once' ? (
            <div className="space-y-2">
              <label htmlFor="schedule-date" className="text-sm font-medium text-foreground">
                {t('options_schedule_field_date')}
              </label>
              <input
                id="schedule-date"
                type="date"
                value={draft.date}
                onChange={e => update('date', e.target.value)}
                className={INPUT_CLASS}
              />
              {dateError ? <p className="text-xs text-destructive">{dateError}</p> : null}
            </div>
          ) : null}
          {draft.frequency === 'weekly' ? (
            <div className="space-y-2">
              <label htmlFor="schedule-weekday" className="text-sm font-medium text-foreground">
                {t('options_schedule_field_weekday')}
              </label>
              <select
                id="schedule-weekday"
                value={draft.weekday}
                onChange={e => update('weekday', Number(e.target.value))}
                className={INPUT_CLASS}>
                {WEEKDAYS.map(day => (
                  <option key={day} value={day}>
                    {weekdayLabel(day)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {draft.frequency === 'monthly' ? (
            <div className="space-y-2">
              <label htmlFor="schedule-day" className="text-sm font-medium text-foreground">
                {t('options_schedule_field_dayOfMonth')}
              </label>
              <select
                id="schedule-day"
                value={draft.dayOfMonth}
                onChange={e => update('dayOfMonth', Number(e.target.value))}
                className={INPUT_CLASS}>
                {DAYS_OF_MONTH.map(day => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t('options_schedule_field_dayOfMonth_hint')}</p>
            </div>
          ) : null}
          <div className="space-y-2">
            <label htmlFor="schedule-time" className="text-sm font-medium text-foreground">
              {t('options_schedule_field_time')}
            </label>
            <input
              id="schedule-time"
              type="time"
              value={draft.time}
              onChange={e => update('time', e.target.value)}
              className={INPUT_CLASS}
            />
            {timeError ? <p className="text-xs text-destructive">{timeError}</p> : null}
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={e => update('enabled', e.target.checked)}
            className="size-4"
          />
          {t('options_schedule_field_enabled')}
        </label>

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button size="compact" onClick={onDone} className="bg-secondary px-4 py-2 text-sm text-foreground">
            {t('options_schedule_btnCancel')}
          </Button>
          <Button
            size="compact"
            onClick={() => void handleSave()}
            disabled={saving}
            className="bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">
            {t('options_schedule_btnSave')}
          </Button>
        </div>
      </div>
    </div>
  );
};
