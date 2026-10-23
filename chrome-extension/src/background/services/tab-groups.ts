import { createLogger } from '../log';

const logger = createLogger('background');

export const TASK_GROUP_TITLE = 'QAgent';
export const TASK_GROUP_DONE_TITLE = 'QAgent ✓';
export const TASK_GROUP_COLOR = 'orange' as const;

interface TaskGroup {
  groupId: number;
  windowId: number;
  tabIds: Set<number>;
}

interface GroupableTab {
  id: number;
  windowId: number;
}

// Callers only pass non-empty lists (join returns early when there are no candidates).
function toTabIds(tabs: GroupableTab[]): [number, ...number[]] {
  return tabs.map(tab => tab.id) as [number, ...number[]];
}

/**
 * Keeps each act-mode task's tabs in one Chrome tab group. Never throws: every tabGroups failure is logged and
 * the task carries on without a group. Tabs the user already grouped, pinned tabs and other windows are left alone.
 */
export class TaskTabGroups {
  private readonly groups = new Map<string, TaskGroup>();
  // Serialises updates so two syncs for the same task cannot both create a group.
  private queue: Promise<void> = Promise.resolve();

  /** Groups the task's tabs and creates the group when needed. */
  start(taskId: string, tabIds: number[]): Promise<void> {
    return this.enqueue(() => this.join(taskId, tabIds));
  }

  /** Adds tabs that joined the task later (for example tabs the task opened). */
  sync(taskId: string, tabIds: number[]): Promise<void> {
    return this.enqueue(() => this.join(taskId, tabIds));
  }

  /** Keeps the group in place, marks it done and forgets it. Ungrouping and closing tabs never happen here. */
  finish(taskId: string): Promise<void> {
    return this.enqueue(async () => {
      const group = this.groups.get(taskId);
      if (!group) return;
      this.groups.delete(taskId);
      await chrome.tabGroups.update(group.groupId, { title: TASK_GROUP_DONE_TITLE, collapsed: false });
    });
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job).catch(error => {
      logger.warning('Tab group update skipped', error);
    });
    this.queue = run;
    return run;
  }

  private async join(taskId: string, tabIds: number[]): Promise<void> {
    const group = this.groups.get(taskId);
    const candidates = await this.groupableTabs(tabIds, group);
    if (candidates.length === 0) return;

    if (group) {
      const fresh = candidates.filter(tab => tab.windowId === group.windowId && !group.tabIds.has(tab.id));
      if (fresh.length === 0) return;
      try {
        await chrome.tabs.group({ groupId: group.groupId, tabIds: toTabIds(fresh) });
        fresh.forEach(tab => group.tabIds.add(tab.id));
        return;
      } catch (error) {
        // The group is gone (its tabs were closed): fall through and create a new one.
        logger.info('Task tab group no longer exists', error);
        this.groups.delete(taskId);
      }
    }

    const windowId = candidates[0].windowId;
    const inWindow = candidates.filter(tab => tab.windowId === windowId);
    const groupId = await chrome.tabs.group({
      tabIds: toTabIds(inWindow),
      createProperties: { windowId },
    });
    await chrome.tabGroups.update(groupId, { title: TASK_GROUP_TITLE, color: TASK_GROUP_COLOR, collapsed: false });
    this.groups.set(taskId, { groupId, windowId, tabIds: new Set(inWindow.map(tab => tab.id)) });
  }

  private async groupableTabs(tabIds: number[], group: TaskGroup | undefined): Promise<GroupableTab[]> {
    const result: GroupableTab[] = [];
    for (const tabId of new Set(tabIds)) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.pinned) continue;
        // Tabs in a group the user made stay where they are; only our own task group is accepted.
        const inOwnGroup = group !== undefined && tab.groupId === group.groupId;
        if (tab.groupId !== -1 && !inOwnGroup) continue;
        result.push({ id: tabId, windowId: tab.windowId });
      } catch {
        // A tab that was closed since the task started is simply skipped.
      }
    }
    return result;
  }
}

export const taskTabGroups = new TaskTabGroups();
