import { describe, expect, it } from 'vitest';
import type { SidePanelResponseMessage } from '@extension/shared';
import { doneActionSchema } from '../../agent/actions/schemas';
import { createTaskCollector } from '../mcpBridge/taskCollector';

const TASK_ID = 'task-1';

function execution(state: string, details = '', step = 1): SidePanelResponseMessage {
  return {
    type: 'execution',
    actor: 'navigator',
    state,
    data: { taskId: TASK_ID, step, maxSteps: 0, details },
    timestamp: 0,
  } as unknown as SidePanelResponseMessage;
}

describe('createTaskCollector', () => {
  it('reports failed, with the last failed step, when the task ends without an answer', () => {
    const collector = createTaskCollector(TASK_ID);
    collector.observe(execution('act.start', 'page_click {"text":"Databases"}'));
    collector.observe(execution('act.fail', 'page_click'));
    collector.observe(execution('act.start', 'qagent_get_status {}', 2));
    collector.observe(execution('act.fail', 'qagent_get_status', 2));
    collector.observe(execution('task.ok', ''));

    const outcome = collector.result();
    expect(outcome.status).toBe('failed');
    expect(outcome.answer).toBeNull();
    expect(outcome.error).toContain('qagent_get_status');
  });

  it('keeps completed when the done action supplies the answer, even after a failed step', () => {
    const collector = createTaskCollector(TASK_ID);
    collector.observe(execution('act.fail', 'page_click'));
    collector.observe(execution('act.start', doneActionSchema.name, 2));
    collector.observe(execution('act.ok', 'The title is QA target.', 2));
    collector.observe(execution('task.ok', ''));

    const outcome = collector.result();
    expect(outcome.status).toBe('completed');
    expect(outcome.answer).toBe('The title is QA target.');
    expect(outcome.error).toBeNull();
  });

  it('keeps completed when a finished chat answer is streamed and no step failed', () => {
    const collector = createTaskCollector(TASK_ID);
    collector.observe({
      type: 'assistant_delta',
      taskId: TASK_ID,
      content: 'It is a login page.',
      finished: true,
    } as unknown as SidePanelResponseMessage);
    collector.observe(execution('task.ok', ''));

    expect(collector.result()).toMatchObject({ status: 'completed', answer: 'It is a login page.', error: null });
  });
});
