import { describe, expect, it } from 'vitest';
import {
  buildProcedureText,
  isRecordedStep,
  pickElementName,
  redactTypedValue,
  REDACTED_VALUE,
  type ProcedureLabels,
  type RecordedStep,
} from '@extension/shared';

const labels: ProcedureLabels = {
  navigate: url => `Abra ${url}`,
  click: element => `Clique em "${element}"`,
  type: (field, value) => `Digite "${value}" em "${field}"`,
  select: (field, value) => `Escolha "${value}" em "${field}"`,
  press: (field, key) => `Pressione ${key} em "${field}"`,
  submit: form => `Envie o formulário "${form}"`,
  unnamed: 'elemento',
};

const field = { role: 'input', name: 'E-mail', selector: '#email', inputType: 'text', autocomplete: '' };

describe('redactTypedValue', () => {
  it('replaces the value of password fields with the redaction marker', () => {
    const result = redactTypedValue('hunter2', { ...field, inputType: 'password', name: 'Senha' });

    expect(result).toEqual({ value: REDACTED_VALUE, redacted: true });
  });

  it('redacts hidden fields and card-like fields by name or autocomplete', () => {
    expect(redactTypedValue('x', { ...field, inputType: 'hidden' }).redacted).toBe(true);
    expect(redactTypedValue('4111', { ...field, autocomplete: 'cc-number' }).redacted).toBe(true);
    expect(redactTypedValue('123', { ...field, name: 'CVV', selector: '#cvv' }).redacted).toBe(true);
  });

  it('keeps ordinary text but truncates it to a short preview', () => {
    const result = redactTypedValue('a'.repeat(100), field);

    expect(result.redacted).toBe(false);
    expect(result.value).toHaveLength(40);
  });
});

describe('pickElementName', () => {
  it('takes the first non-empty candidate and collapses whitespace', () => {
    expect(pickElementName(['', '  Entrar\n agora ', 'Outro'])).toBe('Entrar agora');
  });

  it('returns an empty string when no candidate has text, and bounds long names', () => {
    expect(pickElementName([null, undefined, '   '])).toBe('');
    expect(pickElementName(['x'.repeat(300)])).toHaveLength(80);
  });
});

describe('buildProcedureText', () => {
  it('numbers each recorded step in order and uses the redacted value', () => {
    const steps: RecordedStep[] = [
      { kind: 'navigate', url: 'https://app.test/login', at: 1 },
      {
        kind: 'type',
        url: 'https://app.test/login',
        field,
        value: 'ana@x.com',
        redacted: false,
        at: 2,
      },
      {
        kind: 'type',
        url: 'https://app.test/login',
        field: { role: 'input', name: 'Senha', selector: '#senha' },
        value: REDACTED_VALUE,
        redacted: true,
        at: 3,
      },
      {
        kind: 'click',
        url: 'https://app.test/login',
        element: { role: 'button', name: 'Entrar', selector: 'button.primary' },
        at: 4,
      },
    ];

    expect(buildProcedureText(steps, labels)).toBe(
      [
        '1. Abra https://app.test/login',
        '2. Digite "ana@x.com" em "E-mail"',
        `3. Digite "${REDACTED_VALUE}" em "Senha"`,
        '4. Clique em "Entrar"',
      ].join('\n'),
    );
  });

  it('falls back to the unnamed label when an element has no name', () => {
    const steps: RecordedStep[] = [
      {
        kind: 'click',
        url: 'https://app.test/',
        element: { role: 'div', name: '', selector: 'div.x' },
        at: 1,
      },
    ];

    expect(buildProcedureText(steps, labels)).toBe('1. Clique em "elemento"');
  });

  it('describes Enter presses and submissions as their own lines', () => {
    const steps: RecordedStep[] = [
      {
        kind: 'press',
        url: 'https://app.test/',
        field: { role: 'textbox', name: 'Busca', selector: '#q' },
        key: 'Enter',
        at: 1,
      },
      { kind: 'submit', url: 'https://app.test/', element: { role: 'form', name: 'Login', selector: 'form' }, at: 2 },
    ];

    expect(buildProcedureText(steps, labels)).toBe('1. Pressione Enter em "Busca"\n2. Envie o formulário "Login"');
  });
});

describe('isRecordedStep', () => {
  it('accepts well-formed steps of each kind', () => {
    expect(isRecordedStep({ kind: 'navigate', url: 'https://a.test/', at: 1 })).toBe(true);
    expect(
      isRecordedStep({
        kind: 'click',
        url: 'https://a.test/',
        at: 1,
        element: { role: 'button', name: 'Ok', selector: 'button' },
      }),
    ).toBe(true);
  });

  it('accepts Enter presses and form submissions, and rejects other keys', () => {
    const element = { role: 'textbox', name: 'Busca', selector: '#q' };
    expect(isRecordedStep({ kind: 'press', url: 'https://a.test/', at: 1, field: element, key: 'Enter' })).toBe(true);
    expect(isRecordedStep({ kind: 'press', url: 'https://a.test/', at: 1, field: element, key: 'Escape' })).toBe(false);
    expect(isRecordedStep({ kind: 'submit', url: 'https://a.test/', at: 1, element })).toBe(true);
  });

  it('rejects unknown kinds, non-web URLs and oversized values', () => {
    expect(isRecordedStep({ kind: 'eval', url: 'https://a.test/', at: 1 })).toBe(false);
    expect(isRecordedStep({ kind: 'navigate', url: 'javascript:alert(1)', at: 1 })).toBe(false);
    expect(
      isRecordedStep({
        kind: 'type',
        url: 'https://a.test/',
        at: 1,
        field,
        value: 'x'.repeat(41),
        redacted: false,
      }),
    ).toBe(false);
  });
});
