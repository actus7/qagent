// Pure helpers for "Ensinar o QAgent": step validation, value redaction and the procedure text built from steps.
// Page-derived strings are untrusted; they are only ever stored as plain text, never interpreted as markup.

export const MAX_RECORDED_STEPS = 200;
export const MAX_NAME_CHARS = 80;
export const MAX_TYPED_CHARS = 40;
export const REDACTED_VALUE = '[REDIGIDO]';

export interface ElementDescriptor {
  /** Accessible role or tag name, e.g. "button", "link", "input". */
  role: string;
  /** Visible or accessible label: aria-label, text, placeholder, name or id, whichever is first. */
  name: string;
  /** A CSS selector that identifies the element on the page when the workflow is replayed. */
  selector: string;
}

export interface FieldDescriptor extends ElementDescriptor {
  /** The input type attribute (password, text, hidden, ...). */
  inputType: string;
  /** The autocomplete attribute, used to detect card fields. */
  autocomplete: string;
}

export type RecordedStep =
  | { kind: 'navigate'; url: string; at: number }
  | { kind: 'click'; url: string; element: ElementDescriptor; at: number }
  | { kind: 'type'; url: string; field: ElementDescriptor; value: string; redacted: boolean; at: number }
  | { kind: 'select'; url: string; field: ElementDescriptor; value: string; at: number };

const SENSITIVE_NAME_PATTERN = /pass|senha|card|cartao|cartão|cvv|cvc|pin\b|secret|token|cpf/i;
const SENSITIVE_AUTOCOMPLETE_PATTERN = /^cc-|password/i;

export function isSensitiveField(field: Pick<FieldDescriptor, 'inputType' | 'autocomplete' | 'name' | 'selector'>) {
  if (field.inputType === 'password' || field.inputType === 'hidden') return true;
  if (SENSITIVE_AUTOCOMPLETE_PATTERN.test(field.autocomplete)) return true;
  return SENSITIVE_NAME_PATTERN.test(`${field.name} ${field.selector}`);
}

/** Password, hidden and card values never leave the page; other typed text is cut to a short preview. */
export function redactTypedValue(
  value: string,
  field: Pick<FieldDescriptor, 'inputType' | 'autocomplete' | 'name' | 'selector'>,
): { value: string; redacted: boolean } {
  if (isSensitiveField(field)) return { value: REDACTED_VALUE, redacted: true };
  return { value: value.slice(0, MAX_TYPED_CHARS), redacted: false };
}

/** Picks the first non-empty label candidate and bounds its length. */
export function pickElementName(candidates: (string | null | undefined)[]): string {
  const found = candidates.map(candidate => (candidate ?? '').replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  return found.slice(0, MAX_NAME_CHARS);
}

export interface ProcedureLabels {
  navigate: (url: string) => string;
  click: (element: string) => string;
  type: (field: string, value: string) => string;
  select: (field: string, value: string) => string;
  unnamed: string;
}

/** Deterministic numbered procedure: one line per recorded step, in order. */
export function buildProcedureText(steps: RecordedStep[], labels: ProcedureLabels): string {
  return steps
    .map((step, index) => {
      const text = describeStep(step, labels);
      return `${index + 1}. ${text}`;
    })
    .join('\n');
}

function describeStep(step: RecordedStep, labels: ProcedureLabels): string {
  switch (step.kind) {
    case 'navigate':
      return labels.navigate(step.url);
    case 'click':
      return labels.click(step.element.name || labels.unnamed);
    case 'type':
      return labels.type(step.field.name || labels.unnamed, step.value);
    case 'select':
      return labels.select(step.field.name || labels.unnamed, step.value);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isElement = (value: unknown): value is ElementDescriptor =>
  isRecord(value) &&
  typeof value.role === 'string' &&
  typeof value.name === 'string' &&
  typeof value.selector === 'string' &&
  value.name.length <= MAX_NAME_CHARS &&
  value.selector.length <= 500;

/** Validates a step sent by the content script before it is stored. */
export function isRecordedStep(value: unknown): value is RecordedStep {
  if (!isRecord(value) || typeof value.url !== 'string' || typeof value.at !== 'number') return false;
  if (!/^https?:\/\//i.test(value.url)) return false;
  switch (value.kind) {
    case 'navigate':
      return true;
    case 'click':
      return isElement(value.element);
    case 'type':
      return (
        isElement(value.field) &&
        typeof value.value === 'string' &&
        value.value.length <= MAX_TYPED_CHARS &&
        typeof value.redacted === 'boolean'
      );
    case 'select':
      return isElement(value.field) && typeof value.value === 'string' && value.value.length <= MAX_NAME_CHARS;
    default:
      return false;
  }
}
