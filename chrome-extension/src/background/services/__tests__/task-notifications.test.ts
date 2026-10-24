import { describe, expect, it } from 'vitest';
import { ExecutionState } from '../../agent/event/types';
import { attentionEventForState, shouldNotify } from '../task-notifications';

describe('shouldNotify', () => {
  it('notifies for a finished task when the setting is on and no panel is connected', () => {
    expect(shouldNotify({ enabled: true, panelConnected: false, event: 'completed' })).toBe(true);
  });

  it('stays silent when the setting is off', () => {
    expect(shouldNotify({ enabled: false, panelConnected: false, event: 'failed' })).toBe(false);
  });

  it('stays silent while the side panel is connected to show the result', () => {
    expect(shouldNotify({ enabled: true, panelConnected: true, event: 'completed' })).toBe(false);
  });

  it('stays silent when there is no event that needs the user', () => {
    expect(shouldNotify({ enabled: true, panelConnected: false, event: null })).toBe(false);
  });
});

describe('attentionEventForState', () => {
  it('maps success and failure, and ignores cancels and pauses the user asked for', () => {
    expect(attentionEventForState(ExecutionState.TASK_OK)).toBe('completed');
    expect(attentionEventForState(ExecutionState.TASK_FAIL)).toBe('failed');
    expect(attentionEventForState(ExecutionState.TASK_CANCEL)).toBeNull();
    expect(attentionEventForState(ExecutionState.TASK_PAUSE)).toBeNull();
  });
});
