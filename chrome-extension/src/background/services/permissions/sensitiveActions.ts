// Deterministic, keyword-based sensitivity classifier. Sensitive actions always require explicit confirmation.

/** Target element facts the classifier can use. All fields optional: unknown means no signal. */
export interface SensitiveTarget {
  text?: string;
  ariaLabel?: string;
  name?: string;
  type?: string;
  role?: string;
  autocomplete?: string;
}

export interface SensitiveActionInput {
  action: string;
  intent?: string;
  target?: SensitiveTarget | null;
}

export interface SensitivityResult {
  sensitive: boolean;
  reasons: string[];
}

export const SENSITIVE_KEYWORDS_EN = [
  'buy',
  'purchase',
  'pay',
  'payment',
  'checkout',
  'order',
  'delete',
  'remove',
  'send',
  'publish',
  'post',
  'transfer',
  'place order',
  'confirm purchase',
] as const;

export const SENSITIVE_KEYWORDS_PT_BR = [
  'comprar',
  'compra',
  'pagar',
  'pagamento',
  'finalizar compra',
  'pedido',
  'finalizar pedido',
  'excluir',
  'deletar',
  'remover',
  'enviar',
  'publicar',
  'transferir',
  'transferencia',
  'confirmar compra',
] as const;

/** Actions that run arbitrary code or send local files: always sensitive. */
const ALWAYS_SENSITIVE_ACTIONS: Record<string, string> = {
  execute_javascript: 'script',
  upload_file: 'upload',
};

/** Actions that write text into a field: sensitive when the field is a secret or payment field. */
const TEXT_ENTRY_ACTIONS = new Set(['fill', 'type', 'input_text', 'send_keys']);

const SECRET_AUTOCOMPLETE = /(^|\s)(current-password|new-password|one-time-code|cc-[a-z-]+)(\s|$)/;

/** Lowercases, strips diacritics and collapses whitespace so "Comprar já" matches "comprar". */
export function normalizeForMatch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const KEYWORD_PATTERN = new RegExp(
  `\\b(${[...SENSITIVE_KEYWORDS_EN, ...SENSITIVE_KEYWORDS_PT_BR].map(keyword => escapeRegExp(normalizeForMatch(keyword))).join('|')})\\b`,
);

/** Returns the matched keyword for the text, or null. Word-boundary matching avoids "posts" or "orders" false hits. */
export function findSensitiveKeyword(text: string | undefined): string | null {
  if (!text) return null;
  return KEYWORD_PATTERN.exec(normalizeForMatch(text))?.[1] ?? null;
}

function isSecretField(target: SensitiveTarget): boolean {
  if (target.type?.toLowerCase() === 'password') return true;
  return SECRET_AUTOCOMPLETE.test(normalizeForMatch(target.autocomplete ?? ''));
}

export function classifySensitiveAction(input: SensitiveActionInput): SensitivityResult {
  const reasons: string[] = [];
  const direct = ALWAYS_SENSITIVE_ACTIONS[input.action];
  if (direct) reasons.push(direct);

  const target = input.target ?? null;
  if (target && TEXT_ENTRY_ACTIONS.has(input.action) && isSecretField(target)) reasons.push('secret_field');

  const intentKeyword = findSensitiveKeyword(input.intent);
  if (intentKeyword) reasons.push(`keyword:${intentKeyword}`);

  if (target) {
    const targetKeyword = [target.text, target.ariaLabel, target.name, target.role]
      .map(value => findSensitiveKeyword(value))
      .find(value => value !== null);
    if (targetKeyword) reasons.push(`keyword:${targetKeyword}`);
  }

  return { sensitive: reasons.length > 0, reasons };
}
