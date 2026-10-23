// Registrable-domain helpers used by domain-transition checks and plan-mode domain lists.

// Second-level labels that form a public suffix together with a 2-letter TLD (e.g. com.br, co.uk).
const MULTI_PART_SECOND_LEVEL = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'mil']);

/**
 * Approximates the registrable domain (eTLD+1) of a hostname without a public suffix list.
 * Good enough to tell "different site" apart; IPs and single labels are returned as-is.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return host;
  const labels = host.split('.');
  const lastTwo = labels.slice(-2);
  const [secondLevel, tld] = [labels.at(-2) ?? '', labels.at(-1) ?? ''];
  if (tld.length === 2 && MULTI_PART_SECOND_LEVEL.has(secondLevel) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return lastTwo.join('.');
}

/** Registrable domain of a web URL, or null for non-http(s) or invalid URLs. */
export function registrableDomainOfUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return registrableDomain(parsed.hostname);
  } catch {
    return null;
  }
}

// Group 1 captures a bare host (optionally with a path) when there is no scheme.
const URL_IN_TEXT = /https?:\/\/[^\s"'<>)]+|(?:^|\s)((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s"'<>)]*)?)/gi;

/**
 * Extracts the distinct registrable domains of URLs or bare domains mentioned in free text.
 * Order is preserved (first mention first).
 */
export function extractDomainsFromText(text: string): string[] {
  const domains: string[] = [];
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const candidate = (match[1] ?? match[0]).trim().replace(/[.,;]+$/, '');
    const domain = candidate.startsWith('http')
      ? registrableDomainOfUrl(candidate)
      : registrableDomainOfUrl(`https://${candidate}`);
    if (domain && !domains.includes(domain)) domains.push(domain);
  }
  return domains;
}
