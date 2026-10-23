import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TASK_GROUP_COLOR, TASK_GROUP_DONE_TITLE, TASK_GROUP_TITLE, TaskTabGroups } from '../tab-groups';

interface FakeTab {
  id: number;
  windowId: number;
  groupId: number;
  pinned?: boolean;
}

function installChrome(tabs: FakeTab[]) {
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  let nextGroupId = 100;
  const chromeMock = {
    tabs: {
      get: vi.fn(async (id: number) => {
        const tab = byId.get(id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        return tab;
      }),
      group: vi.fn(async (options: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }) => {
        const groupId = options.groupId ?? nextGroupId++;
        for (const id of options.tabIds) {
          const tab = byId.get(id);
          if (tab) tab.groupId = groupId;
        }
        return groupId;
      }),
    },
    tabGroups: {
      update: vi.fn(async () => ({})),
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  return { chromeMock, byId };
}

describe('TaskTabGroups', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('puts the selected tabs into one QAgent group with a fixed color', async () => {
    const { chromeMock, byId } = installChrome([
      { id: 1, windowId: 7, groupId: -1 },
      { id: 2, windowId: 7, groupId: -1 },
    ]);
    const groups = new TaskTabGroups();

    await groups.start('task-a', [1, 2]);

    expect(chromeMock.tabs.group).toHaveBeenCalledWith({ tabIds: [1, 2], createProperties: { windowId: 7 } });
    expect(byId.get(1)?.groupId).toBe(100);
    expect(chromeMock.tabGroups.update).toHaveBeenCalledWith(100, {
      title: TASK_GROUP_TITLE,
      color: TASK_GROUP_COLOR,
      collapsed: false,
    });
  });

  it('adds tabs opened later to the existing group without regrouping known tabs', async () => {
    const { chromeMock } = installChrome([
      { id: 1, windowId: 7, groupId: -1 },
      { id: 2, windowId: 7, groupId: -1 },
    ]);
    const groups = new TaskTabGroups();
    await groups.start('task-a', [1]);

    await groups.sync('task-a', [1, 2]);
    await groups.sync('task-a', [1, 2]);

    expect(chromeMock.tabs.group).toHaveBeenLastCalledWith({ groupId: 100, tabIds: [2] });
    expect(chromeMock.tabs.group).toHaveBeenCalledTimes(2);
  });

  it('skips pinned tabs and tabs the user already put in another group', async () => {
    const { chromeMock } = installChrome([
      { id: 1, windowId: 7, groupId: -1, pinned: true },
      { id: 2, windowId: 7, groupId: 55 },
      { id: 3, windowId: 7, groupId: -1 },
    ]);
    const groups = new TaskTabGroups();

    await groups.start('task-a', [1, 2, 3]);

    expect(chromeMock.tabs.group).toHaveBeenCalledWith({ tabIds: [3], createProperties: { windowId: 7 } });
  });

  it('marks the group done on finish without ungrouping or closing tabs', async () => {
    const { chromeMock, byId } = installChrome([{ id: 1, windowId: 7, groupId: -1 }]);
    const groups = new TaskTabGroups();
    await groups.start('task-a', [1]);

    await groups.finish('task-a');

    expect(chromeMock.tabGroups.update).toHaveBeenLastCalledWith(100, {
      title: TASK_GROUP_DONE_TITLE,
      collapsed: false,
    });
    expect(byId.get(1)?.groupId).toBe(100);
    expect(chromeMock.tabs.group).toHaveBeenCalledTimes(1);
  });

  it('ignores finish for a task that never grouped anything', async () => {
    const { chromeMock } = installChrome([]);
    await new TaskTabGroups().finish('unknown');
    expect(chromeMock.tabGroups.update).not.toHaveBeenCalled();
  });

  it('logs and swallows tabGroups errors so the task is never blocked', async () => {
    const { chromeMock } = installChrome([{ id: 1, windowId: 7, groupId: -1 }]);
    chromeMock.tabs.group.mockRejectedValueOnce(new Error('Tabs cannot be grouped in a popup window'));
    const groups = new TaskTabGroups();

    await expect(groups.start('task-a', [1])).resolves.toBeUndefined();
    await expect(groups.finish('task-a')).resolves.toBeUndefined();
  });

  it('creates a fresh group when the previous one was closed by the user', async () => {
    const { chromeMock, byId } = installChrome([
      { id: 1, windowId: 7, groupId: -1 },
      { id: 2, windowId: 7, groupId: -1 },
    ]);
    const groups = new TaskTabGroups();
    await groups.start('task-a', [1]);
    chromeMock.tabs.group.mockRejectedValueOnce(new Error('No group with id: 100'));

    await groups.sync('task-a', [1, 2]);

    expect(byId.get(2)?.groupId).toBe(101);
    expect(chromeMock.tabGroups.update).toHaveBeenLastCalledWith(101, expect.objectContaining({ title: 'QAgent' }));
  });
});
