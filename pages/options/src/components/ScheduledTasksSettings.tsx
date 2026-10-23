import { useCallback, useEffect, useState } from 'react';
import { computeNextRunAt, scheduledTasksStore, type ScheduledTask, type ScheduleRun } from '@extension/storage';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';
import { ScheduleForm, weekdayLabel } from './ScheduleForm';

const RECENT_RUNS_SHOWN = 5;

const formatDateTime = (timestamp: number): string => new Date(timestamp).toLocaleString();

/** Short line describing when and how often the schedule runs, e.g. "Diária às 09:00". */
const describeTiming = (task: ScheduledTask): string => {
  switch (task.frequency) {
    case 'once':
      return t('options_schedule_freqDesc_once', [task.date ?? '', task.time]);
    case 'daily':
      return t('options_schedule_freqDesc_daily', [task.time]);
    case 'weekly':
      return t('options_schedule_freqDesc_weekly', [weekdayLabel(task.weekday), task.time]);
    case 'monthly':
      return t('options_schedule_freqDesc_monthly', [String(task.dayOfMonth), task.time]);
  }
};

const outcomeLabel = (run: ScheduleRun): string => t(`options_schedule_outcome_${run.outcome}`);

export const ScheduledTasksSettings = () => {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setTasks(await scheduledTasksStore.getTasks());
    } catch (loadError) {
      console.error('Failed to load scheduled tasks:', loadError);
      setError(t('options_schedule_error_loadFailed'));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    return scheduledTasksStore.subscribe(() => void reload());
  }, [reload]);

  const runAction = async (action: () => Promise<void>, failure: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError) {
      console.error(failure, actionError);
      setError(failure);
    }
  };

  const handleToggle = (task: ScheduledTask) =>
    runAction(async () => {
      if (task.enabled) {
        await scheduledTasksStore.saveTask({ ...task, enabled: false });
        return;
      }
      // Re-enabling recomputes the next run so a stale time in the past never fires at once.
      const nextRunAt = computeNextRunAt(task, Date.now());
      if (nextRunAt === null) {
        setError(t('options_schedule_error_dateInPast'));
        return;
      }
      await scheduledTasksStore.saveTask({ ...task, enabled: true, nextRunAt });
    }, t('options_schedule_error_saveFailed'));

  const handleRunNow = (task: ScheduledTask) =>
    runAction(async () => {
      const response = (await chrome.runtime.sendMessage({ type: 'qagent:schedule:run-now', id: task.id })) as
        { ok: boolean } | undefined;
      if (!response?.ok) throw new Error('run-now rejected');
      setNotice(t('options_schedule_runStarted'));
    }, t('options_schedule_error_runFailed'));

  const handleDelete = (task: ScheduledTask) => {
    if (!window.confirm(t('options_schedule_deleteConfirm', [task.name]))) return;
    void runAction(() => scheduledTasksStore.removeTask(task.id), t('options_schedule_error_deleteFailed'));
  };

  if (editing) {
    return (
      <ScheduleForm
        task={editing === 'new' ? null : editing}
        taskCount={tasks.length}
        onDone={() => {
          setEditing(null);
          void reload();
        }}
      />
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-6 text-left shadow-xs">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-foreground">{t('options_schedule_header')}</h2>
          <Button
            onClick={() => setEditing('new')}
            className="bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">
            {t('options_schedule_btnNew')}
          </Button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{t('options_schedule_intro')}</p>

        {error ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? <p className="mb-3 text-sm text-muted-foreground">{notice}</p> : null}

        {loaded && tasks.length === 0 ? (
          <p className="rounded-md bg-muted p-4 text-center text-sm text-muted-foreground">
            {t('options_schedule_empty')}
          </p>
        ) : null}

        <ul className="space-y-3">
          {tasks.map(task => (
            <li key={task.id} className="rounded-md border border-border bg-muted/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-base font-medium text-foreground">{task.name}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{task.prompt}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`options_schedule_mode_${task.mode}`)}
                    {task.startUrl ? ` · ${task.startUrl}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {describeTiming(task)} ·{' '}
                    {task.enabled && task.nextRunAt
                      ? t('options_schedule_nextRun', [formatDateTime(task.nextRunAt)])
                      : t('options_schedule_nextRun_none')}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={task.enabled}
                    onChange={() => void handleToggle(task)}
                    className="size-4"
                  />
                  {t('options_schedule_enabled')}
                </label>
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium text-foreground">{t('options_schedule_lastRuns')}</p>
                {task.history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('options_schedule_noRuns')}</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {task.history
                      .slice(-RECENT_RUNS_SHOWN)
                      .reverse()
                      .map(run => (
                        <li key={`${run.at}-${run.outcome}`} className="text-xs text-muted-foreground">
                          {formatDateTime(run.at)} · {outcomeLabel(run)}
                          {run.detail ? ` · ${run.detail}` : ''}
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  onClick={() => void handleRunNow(task)}
                  className="bg-secondary px-3 py-1.5 text-xs text-foreground">
                  {t('options_schedule_btnRunNow')}
                </Button>
                <Button onClick={() => setEditing(task)} className="bg-secondary px-3 py-1.5 text-xs text-foreground">
                  {t('options_schedule_btnEdit')}
                </Button>
                <Button
                  onClick={() => handleDelete(task)}
                  className="bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:opacity-90">
                  {t('options_schedule_btnDelete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
