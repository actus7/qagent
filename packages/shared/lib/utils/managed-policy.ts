/**
 * Enterprise policy read from chrome.storage.managed (schema: chrome-extension/public/managed-schema.json).
 * Every key is optional; an unmanaged browser yields EMPTY_MANAGED_POLICY (no restrictions).
 */
export interface ManagedPolicy {
  blockedUrlPatterns: string[];
  allowedUrlPatterns: string[];
  disableJavascriptTool: boolean;
  disableFileUpload: boolean;
  allowedProviders: string[];
}

export type ManagedUrlDecision = { allowed: true } | { allowed: false; reason: 'blocked_pattern' | 'not_in_allowlist' };

const MAX_PATTERNS = 500;
const MAX_PATTERN_LENGTH = 300;

export const EMPTY_MANAGED_POLICY: ManagedPolicy = {
  blockedUrlPatterns: [],
  allowedUrlPatterns: [],
  disableJavascriptTool: false,
  disableFileUpload: false,
  allowedProviders: [],
};

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0 && item.length <= MAX_PATTERN_LENGTH);
  return [...new Set(entries)].slice(0, MAX_PATTERNS);
}

/** Converts untrusted managed storage into a policy. Wrong types are ignored, never trusted. */
export function parseManagedPolicy(raw: unknown): ManagedPolicy {
  if (typeof raw !== 'object' || raw === null) return EMPTY_MANAGED_POLICY;
  const record = raw as Record<string, unknown>;
  return {
    blockedUrlPatterns: sanitizeStringList(record.blockedUrlPatterns),
    allowedUrlPatterns: sanitizeStringList(record.allowedUrlPatterns),
    disableJavascriptTool: record.disableJavascriptTool === true,
    disableFileUpload: record.disableFileUpload === true,
    allowedProviders: sanitizeStringList(record.allowedProviders).map(id => id.toLowerCase()),
  };
}

export function hasManagedRestrictions(policy: ManagedPolicy): boolean {
  return (
    policy.blockedUrlPatterns.length > 0 ||
    policy.allowedUrlPatterns.length > 0 ||
    policy.disableJavascriptTool ||
    policy.disableFileUpload ||
    policy.allowedProviders.length > 0
  );
}

/** Glob with `*` as the only wildcard; everything else is literal. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function stripWww(host: string): string {
  return host.replace(/^www\./, '');
}

/** Host rules: `example.com` covers the host and its subdomains; `*.example.com` is the same; other `*` are globs. */
function matchesHost(hostname: string, hostPattern: string): boolean {
  const pattern = stripWww(hostPattern.replace(/\.+$/, ''));
  if (!pattern) return false;
  if (pattern.startsWith('*.')) {
    const domain = pattern.slice(2);
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }
  if (!pattern.includes('*')) {
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  }
  return globToRegExp(pattern).test(hostname);
}

/** Path rules: no path matches any path; a plain path also covers its children; `*` is a glob. */
function matchesPath(pathname: string, pathPattern: string): boolean {
  if (!pathPattern || pathPattern === '/') return true;
  if (pathPattern.includes('*')) return globToRegExp(pathPattern).test(pathname);
  const base = pathPattern.endsWith('/') ? pathPattern.slice(0, -1) : pathPattern;
  return pathname === base || pathname === `${base}/` || pathname.startsWith(`${base}/`);
}

/**
 * Matches a URL against a managed pattern such as `intranet.acme.com/app/*`, `https://*.acme.com`
 * or `*.acme.com/login`. The scheme is optional; when given it must match (`*` means http or https).
 */
export function matchUrlPattern(url: string, pattern: string): boolean {
  const normalized = pattern.trim().toLowerCase();
  if (!normalized) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  let rest = normalized;
  const schemeMatch = /^([a-z*]+):\/\//.exec(normalized);
  if (schemeMatch) {
    const scheme = schemeMatch[1];
    if (scheme !== '*' && scheme !== parsed.protocol.slice(0, -1)) return false;
    rest = normalized.slice(schemeMatch[0].length);
  }

  const slash = rest.indexOf('/');
  const hostPattern = slash === -1 ? rest : rest.slice(0, slash);
  const pathPattern = slash === -1 ? '' : rest.slice(slash);
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');

  return matchesHost(hostname, hostPattern) && matchesPath(parsed.pathname.toLowerCase(), pathPattern);
}

export function evaluateManagedUrl(url: string, policy: ManagedPolicy): ManagedUrlDecision {
  if (policy.blockedUrlPatterns.some(pattern => matchUrlPattern(url, pattern))) {
    return { allowed: false, reason: 'blocked_pattern' };
  }
  if (policy.allowedUrlPatterns.length > 0 && !policy.allowedUrlPatterns.some(pattern => matchUrlPattern(url, pattern))) {
    return { allowed: false, reason: 'not_in_allowlist' };
  }
  return { allowed: true };
}

const JAVASCRIPT_ACTIONS = new Set(['execute_javascript']);
const UPLOAD_ACTIONS = new Set(['upload_file', 'upload']);

export function isManagedActionAllowed(actionName: string, policy: ManagedPolicy): boolean {
  if (policy.disableJavascriptTool && JAVASCRIPT_ACTIONS.has(actionName)) return false;
  if (policy.disableFileUpload && UPLOAD_ACTIONS.has(actionName)) return false;
  return true;
}

/** Provider is matched by its configured id or by its provider type (case-insensitive). */
export function isManagedProviderAllowed(provider: { id: string; type?: string }, policy: ManagedPolicy): boolean {
  if (policy.allowedProviders.length === 0) return true;
  const candidates = [provider.id, provider.type].filter((value): value is string => !!value).map(v => v.toLowerCase());
  return candidates.some(candidate => policy.allowedProviders.includes(candidate));
}
