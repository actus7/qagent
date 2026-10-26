import { describe, expect, it } from 'vitest';
import type { RecordedStep } from '@extension/shared';
import type { WorkflowStep } from '@extension/storage';
import { normalizeRecording } from '../normalize';
import { planWorkflowReplay } from '../planner';
import { renderText, variableNamesOf } from '../templating';
import { extractJsonObject, parseWorkflowDraft, toWorkflow, withDeclaredVariables } from '../draft';

const at = 1;
const url = 'https://shop.example.com/cart';
const button = { role: 'button', name: 'Pay', selector: 'button.pay' };
const field = { role: 'textbox', name: 'Email', selector: '#email' };

describe('normalizeRecording', () => {
  it('returns no steps for an empty recording', () => {
    expect(normalizeRecording([])).toEqual([]);
  });

  it('drops a click identical to the one before it', () => {
    const steps: RecordedStep[] = [
      { kind: 'click', url, element: button, at },
      { kind: 'click', url, element: button, at },
    ];
    expect(normalizeRecording(steps)).toEqual([
      { kind: 'click', target: { selector: 'button.pay', text: 'Pay', role: 'button' } },
    ]);
  });

  it('merges consecutive typing in one field so only the last value remains', () => {
    const steps: RecordedStep[] = [
      { kind: 'type', url, field, value: 'a', redacted: false, at },
      { kind: 'type', url, field, value: 'ana@x.com', redacted: false, at },
    ];
    const result = normalizeRecording(steps);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'fill', value: 'ana@x.com' });
  });

  it('turns a redacted value into a secret variable instead of storing it', () => {
    const steps: RecordedStep[] = [
      {
        kind: 'type',
        url,
        field: { role: 'textbox', name: 'Senha', selector: '#pw' },
        value: '[REDIGIDO]',
        redacted: true,
        at,
      },
    ];
    expect(normalizeRecording(steps)[0]).toMatchObject({ kind: 'fill', value: '{{secret_1}}' });
  });

  it('drops navigations caused by a click and maps a submit to an Enter press', () => {
    const steps: RecordedStep[] = [
      { kind: 'click', url, element: button, at },
      { kind: 'navigate', url: 'https://shop.example.com/done', at },
      { kind: 'submit', url, element: button, at },
    ];
    expect(normalizeRecording(steps).map(step => step.kind)).toEqual(['click', 'press']);
  });
});

describe('variable templating', () => {
  it('replaces each placeholder with its value', () => {
    expect(renderText('Hello {{ name }}, {{name}}', { name: 'Ana' })).toBe('Hello Ana, Ana');
  });

  it('lists the variables used across steps, sorted and unique', () => {
    const steps: WorkflowStep[] = [
      { kind: 'fill', target: { text: 'Email' }, value: '{{email}}' },
      { kind: 'navigate', url: 'https://x.com/{{city}}' },
      { kind: 'fill', target: { text: 'Mail' }, value: '{{email}}' },
    ];
    expect(variableNamesOf(steps)).toEqual(['city', 'email']);
  });
});

describe('planWorkflowReplay', () => {
  const workflow = {
    steps: [
      { kind: 'navigate', url: 'https://shop.example.com/{{city}}' },
      { kind: 'fill', target: { selector: '#email', text: 'Email', role: 'textbox' }, value: '{{email}}' },
      { kind: 'select', target: { text: 'Country', role: 'combobox' }, value: '{{country}}' },
      { kind: 'press', key: 'Enter' },
    ] as WorkflowStep[],
  };

  it('maps steps to existing actions with the variables substituted', () => {
    const plan = planWorkflowReplay(workflow, { city: 'rio', email: 'a@b.com', country: 'Brasil' });
    expect(plan).toEqual({
      ok: true,
      calls: [
        {
          action: 'go_to_url',
          input: { url: 'https://shop.example.com/rio' },
          label: 'open https://shop.example.com/rio',
        },
        {
          action: 'fill',
          input: { target: { selector: '#email', text: 'Email', role: 'textbox' }, text: 'a@b.com' },
          label: 'fill',
        },
        { action: 'click', input: { target: { text: 'Country', role: 'combobox' } }, label: 'open dropdown' },
        { action: 'click', input: { target: { text: 'Brasil', role: 'option' } }, label: 'choose Brasil' },
        { action: 'press', input: { key: 'Enter' }, label: 'press Enter' },
      ],
    });
  });

  it('refuses to run when a variable has no value', () => {
    const plan = planWorkflowReplay(workflow, { city: 'rio', email: 'a@b.com' });
    expect(plan).toEqual({ ok: false, error: 'Missing workflow variables: country' });
  });
});

describe('workflow draft validation', () => {
  it('accepts a well-formed model reply and fills in undeclared variables', () => {
    const raw = {
      name: 'Checkout',
      steps: [{ kind: 'fill', target: { text: 'Email' }, value: '{{email}}' }],
    };
    const draft = parseWorkflowDraft(raw);
    expect(withDeclaredVariables(draft)).toEqual([{ name: 'email', description: 'Value entered for this step' }]);
    expect(toWorkflow(draft, 'checkout', 5).variables).toHaveLength(1);
  });

  it('rejects a step kind it cannot replay', () => {
    expect(() => parseWorkflowDraft({ name: 'x', steps: [{ kind: 'eval', code: '1' }] })).toThrow();
  });

  it('extracts the JSON object from prose around it', () => {
    expect(extractJsonObject('Here it is: {"a": 1} thanks')).toEqual({ a: 1 });
    expect(() => extractJsonObject('no json here')).toThrow('no JSON object');
  });
});
