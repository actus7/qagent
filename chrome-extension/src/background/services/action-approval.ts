import { t } from '@extension/i18n';
import type { ActionApproval, PermissionMode, SidePanelResponseMessage } from '@extension/shared';
import type { BrowserContextLike } from '../browser/types';
import { RequestCancelledError } from '../agent/agents/errors';

const READ_ACTIONS = new Set([
  'done',
  'wait',
  'get_text',
  'get_title',
  'get_url',
  'snapshot',
  'cache_content',
  'get_dropdown_options',
  'scroll',
  'scroll_to_percent',
  'scroll_to_top',
  'scroll_to_bottom',
  'scroll_into_view',
  'scroll_to_text',
  'previous_page',
  'next_page',
]);

export class ActionApprovalManager {
  private pending: { request: ActionApproval; resolve: (approved: boolean) => void } | null = null;

  constructor(private readonly post: (message: SidePanelResponseMessage) => void) {}

  async authorize(
    taskId: string,
    action: string,
    input: unknown,
    mode: PermissionMode,
    browser: BrowserContextLike,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error(t('bg_task_interrupted'));
    if (mode === 'auto' || READ_ACTIONS.has(action)) return;
    if (this.pending) throw new Error(t('bg_approval_busy'));
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const tabId = browser.currentTabId;
    const tab = tabId === null ? null : await chrome.tabs.get(tabId);
    const request: ActionApproval = {
      id: crypto.randomUUID(),
      taskId,
      action,
      tabId,
      url: tab?.url ?? '',
      description: typeof args.intent === 'string' ? args.intent : action,
      parameters: JSON.stringify(args, null, 2).slice(0, 2000),
    };
    const approved = await new Promise<boolean>((resolve, reject) => {
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), 5 * 60 * 1000);
      const finish = (result: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.pending = null;
        resolve(result);
      };
      this.pending = { request, resolve: finish };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        this.post({ type: 'approval_required', request });
      } catch (error) {
        finish(false);
        reject(error);
      }
      if (signal.aborted) finish(false);
    });
    this.post({ type: 'approval_resolved', requestId: request.id });
    if (!approved || signal.aborted) throw new RequestCancelledError(t('bg_approval_declined'));
    // An approval applies to the exact page displayed to the user, not a page reached meanwhile.
    if (tabId !== browser.currentTabId || (tabId !== null && (await chrome.tabs.get(tabId)).url !== request.url)) {
      throw new Error(t('bg_approval_pageChanged'));
    }
  }

  resolve(taskId: string, requestId: string, approved: boolean): boolean {
    if (this.pending?.request.id !== requestId || this.pending.request.taskId !== taskId) return false;
    this.pending.resolve(approved);
    return true;
  }

  cancel(): void {
    this.pending?.resolve(false);
  }
}
