import type { PermissionMode } from '@extension/shared';
import { normalizeSiteOrigin } from '@extension/storage';
import { registrableDomainOfUrl } from './domainTransition';

export interface PlanState {
  approved: boolean;
  // Registrable domains the approved plan intends to visit.
  domains: string[];
}

export interface AccessInput {
  mode: PermissionMode;
  sensitive: boolean;
  isNavigation: boolean;
  currentUrl: string;
  // Destination of a navigation action (go_to_url, open_tab, search); null for other actions.
  targetUrl: string | null;
  alwaysAllowedOrigins: string[];
  plan: PlanState | null;
}

export type AccessDecision = { kind: 'allow' } | { kind: 'ask'; transition: { from: string; to: string } | null };

/** Returns true when the URL's origin is in the always-allowed list. */
export function isOriginAlwaysAllowed(url: string, alwaysAllowedOrigins: string[]): boolean {
  const origin = normalizeSiteOrigin(url);
  return origin !== null && alwaysAllowedOrigins.includes(origin);
}

/**
 * Decides whether an action runs without asking. Sensitive actions always ask.
 * - auto: everything else runs.
 * - ask: runs only on always-allowed origins (for navigations: the destination origin).
 * - plan: runs when the approved plan covers the destination domain, or the origin is always-allowed.
 * The transition is reported when a navigation leaves the current registrable domain.
 */
export function decideAccess(input: AccessInput): AccessDecision {
  const transition = buildTransition(input);
  if (input.sensitive) return { kind: 'ask', transition };
  if (input.mode === 'auto') return { kind: 'allow' };

  const relevantUrl = input.isNavigation && input.targetUrl ? input.targetUrl : input.currentUrl;
  if (isOriginAlwaysAllowed(relevantUrl, input.alwaysAllowedOrigins)) return { kind: 'allow' };

  if (input.mode === 'plan' && input.plan?.approved) {
    const domain = registrableDomainOfUrl(relevantUrl);
    if (domain && input.plan.domains.includes(domain)) return { kind: 'allow' };
  }
  return { kind: 'ask', transition };
}

function buildTransition(input: AccessInput): { from: string; to: string } | null {
  if (!input.isNavigation || !input.targetUrl) return null;
  const from = registrableDomainOfUrl(input.currentUrl);
  const to = registrableDomainOfUrl(input.targetUrl);
  if (!to || from === to) return null;
  return { from: from ?? input.currentUrl, to };
}
