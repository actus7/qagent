import { t } from '@extension/i18n';
import { sitePermissionsStore } from '@extension/storage';
import type { ActionApproval, ApprovalDecision, PermissionMode, SidePanelResponseMessage } from '@extension/shared';
import type { BrowserContextLike } from '../browser/types';
import { RequestCancelledError } from '../agent/agents/errors';
import { createLogger } from '../log';
import { extractDomainsFromText, registrableDomainOfUrl } from './permissions/domainTransition';
import { classifySensitiveAction, type SensitiveTarget } from './permissions/sensitiveActions';
import { decideAccess, type PlanState } from './permissions/permissionPolicy';

const logger = createLogger('background');

const READ_ACTIONS = new Set([
  'done',
  // Pauses the task for the user; it changes nothing on the page itself.
  'request_user_takeover',
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
  // Inspection only; resize changes emulation, not site data, and is reset when the task ends.
  'read_console_messages',
  'read_network_requests',
  'resize_viewport',
]);

/** Actions whose destination is known from their input, so domain transitions can be checked before they run. */
const NAVIGATION_ACTIONS = new Set(['go_to_url', 'open_tab', 'search_google']);

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingApproval {
  request: ActionApproval;
  resolve: (decision: ApprovalDecision) => void;
}

interface ApprovalDeps {
  sitePermissions: Pick<typeof sitePermissionsStore, 'getAllowedOrigins' | 'addOrigin'>;
}

/** Destination URL of a navigation action, or null when the input does not name one. */
export function navigationTargetUrl(action: string, args: Record<string, unknown>): string | null {
  if (!NAVIGATION_ACTIONS.has(action)) return null;
  if (action === 'search_google') {
    return typeof args.query === 'string' ? `https://www.google.com/search?q=${encodeURIComponent(args.query)}` : null;
  }
  return typeof args.url === 'string' ? args.url : null;
}

function stringAttribute(attributes: Record<string, string> | undefined, name: string): string | undefined {
  const value = attributes?.[name];
  return typeof value === 'string' ? value : undefined;
}

export class ActionApprovalManager {
  private pending: PendingApproval | null = null;
  private readonly planStates = new Map<string, PlanState>();
  private readonly taskTexts = new Map<string, string>();

  constructor(
    private readonly post: (message: SidePanelResponseMessage) => void,
    private readonly deps: ApprovalDeps = { sitePermissions: sitePermissionsStore },
  ) {}

  /** Records the task text so plan approval can list the domains the task mentions. */
  startTask(taskId: string, task: string): void {
    this.taskTexts.set(taskId, task);
    this.planStates.delete(taskId);
  }

  async authorize(
    taskId: string,
    action: string,
    input: unknown,
    mode: PermissionMode,
    browser: BrowserContextLike,
    signal: AbortSignal,
    planNextSteps: string | null = null,
  ): Promise<void> {
    if (signal.aborted) throw new Error(t('bg_task_interrupted'));
    if (READ_ACTIONS.has(action)) return;
    if (this.pending) throw new Error(t('bg_approval_busy'));
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const tabId = browser.currentTabId;
    const tab = tabId === null ? null : await chrome.tabs.get(tabId);
    const currentUrl = tab?.url ?? '';
    const intent = typeof args.intent === 'string' ? args.intent : undefined;
    const target = await this.describeTarget(browser, args);
    const sensitivity = classifySensitiveAction({ action, intent, target });
    const targetUrl = navigationTargetUrl(action, args);

    if (mode === 'plan' && !this.planStates.get(taskId)?.approved) {
      await this.requestPlanApproval(taskId, action, intent, currentUrl, browser, signal, planNextSteps);
    }

    const alwaysAllowed = sensitivity.sensitive ? [] : await this.loadAlwaysAllowedOrigins();
    const access = decideAccess({
      mode,
      sensitive: sensitivity.sensitive,
      isNavigation: targetUrl !== null,
      currentUrl,
      targetUrl,
      alwaysAllowedOrigins: alwaysAllowed,
      plan: this.planStates.get(taskId) ?? null,
    });
    if (access.kind === 'allow') return;

    const request: ActionApproval = {
      id: crypto.randomUUID(),
      taskId,
      action,
      tabId,
      url: currentUrl,
      targetUrl: targetUrl ?? undefined,
      description: intent ?? action,
      parameters: JSON.stringify(args, null, 2).slice(0, 2000),
      kind: 'action',
      sensitive: sensitivity.sensitive,
      sensitiveReasons: sensitivity.sensitive ? sensitivity.reasons : undefined,
      transition: access.transition ?? undefined,
      allowSiteOption: !sensitivity.sensitive,
    };
    const decision = await this.waitForDecision(request, signal);
    this.post({ type: 'approval_resolved', requestId: request.id });
    if (decision === 'deny' || signal.aborted) throw new RequestCancelledError(t('bg_approval_declined'));
    if (decision === 'always_site' && !sensitivity.sensitive) {
      await this.deps.sitePermissions.addOrigin(targetUrl ?? currentUrl);
    }
    // An approval applies to the exact page displayed to the user, not a page reached meanwhile.
    if (tabId !== browser.currentTabId || (tabId !== null && (await chrome.tabs.get(tabId)).url !== request.url)) {
      throw new Error(t('bg_approval_pageChanged'));
    }
  }

  /** Asks once per task to approve the domains the plan will visit. Denial stops the task. */
  private async requestPlanApproval(
    taskId: string,
    action: string,
    intent: string | undefined,
    currentUrl: string,
    browser: BrowserContextLike,
    signal: AbortSignal,
    planNextSteps: string | null,
  ): Promise<void> {
    const taskText = this.taskTexts.get(taskId) ?? '';
    const domains = [
      ...new Set([
        ...(registrableDomainOfUrl(currentUrl) ? [registrableDomainOfUrl(currentUrl) as string] : []),
        ...extractDomainsFromText(taskText),
      ]),
    ];
    const request: ActionApproval = {
      id: crypto.randomUUID(),
      taskId,
      action,
      tabId: browser.currentTabId,
      url: currentUrl,
      description: intent ?? taskText,
      kind: 'plan',
      domains,
      planSteps: planNextSteps ?? undefined,
    };
    const decision = await this.waitForDecision(request, signal);
    this.post({ type: 'approval_resolved', requestId: request.id });
    if (decision === 'deny' || signal.aborted) throw new RequestCancelledError(t('bg_approval_declined'));
    this.planStates.set(taskId, { approved: true, domains });
  }

  private waitForDecision(request: ActionApproval, signal: AbortSignal): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve, reject) => {
      const onAbort = () => finish('deny');
      const timer = setTimeout(() => finish('deny'), APPROVAL_TIMEOUT_MS);
      const finish = (result: ApprovalDecision) => {
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
        finish('deny');
        reject(error);
      }
      if (signal.aborted) finish('deny');
    });
  }

  private async loadAlwaysAllowedOrigins(): Promise<string[]> {
    try {
      return await this.deps.sitePermissions.getAllowedOrigins();
    } catch (error) {
      // Fail closed: without the stored list every action asks again.
      logger.error('Failed to read site permissions; asking for approval', error);
      return [];
    }
  }

  /** Reads the target element's text and attributes from the cached page state, if the action names one. */
  private async describeTarget(
    browser: BrowserContextLike,
    args: Record<string, unknown>,
  ): Promise<SensitiveTarget | null> {
    if (typeof args.index !== 'number' || browser.currentTabId === null) return null;
    try {
      const page = await browser.getCurrentPage();
      const node = page.getCachedState()?.selectorMap.get(args.index);
      if (!node) return null;
      const attributes = node.attributes;
      return {
        text: node.getAllTextTillNextClickableElement(),
        ariaLabel: stringAttribute(attributes, 'aria-label'),
        name: stringAttribute(attributes, 'name'),
        type: stringAttribute(attributes, 'type'),
        role: stringAttribute(attributes, 'role'),
        autocomplete: stringAttribute(attributes, 'autocomplete'),
      };
    } catch (error) {
      logger.error('Failed to read target element for sensitivity check', error);
      return null;
    }
  }

  /**
   * Resolves the pending request. `decision` defaults to once/deny from `approved`.
   * Returns false when the request is not the pending one for this task.
   */
  resolve(taskId: string, requestId: string, approved: boolean, decision?: ApprovalDecision): boolean {
    if (this.pending?.request.id !== requestId || this.pending.request.taskId !== taskId) return false;
    this.pending.resolve(decision ?? (approved ? 'once' : 'deny'));
    return true;
  }

  cancel(): void {
    this.pending?.resolve('deny');
  }
}
