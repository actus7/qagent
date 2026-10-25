import {
  pickElementName,
  redactTypedValue,
  type ElementDescriptor,
  type FieldDescriptor,
  type RecordedStep,
} from '@extension/shared/lib/utils/workflow-recording';
import { buildElementSelector, escapeAttributeValue, type SelectorNode } from '@extension/shared/lib/utils/workflow-selector';

// Message names shared with the background service worker (chrome-extension/src/background/services/workflowRecording.ts).
const STEP_MESSAGE = 'qagent:recording:step';
const STOP_REQUEST_MESSAGE = 'qagent:recording:stop-request';
const START_MESSAGE = 'qagent:recording:start';
const STOP_MESSAGE = 'qagent:recording:stop';

const OVERLAY_HOST_ID = 'qagent-overlay-host';
const INDICATOR_HOST_ID = 'qagent-recording-host';
// Typing is recorded once the field settles, so the step carries the final value only.
const TYPE_SETTLE_MS = 800;
// Enter in a form field usually submits the form; wait briefly so the submit event can replace the press step.
const ENTER_SUBMIT_WINDOW_MS = 300;
const MAX_TEXT_SAMPLE_CHARS = 200;
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset']);
const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color']);
const ROLE_BY_TAG: Record<string, string> = { a: 'link', button: 'button', select: 'combobox', textarea: 'textbox' };

type TextField = HTMLInputElement | HTMLTextAreaElement;

let active = false;
let pendingText: { field: TextField; timer: ReturnType<typeof setTimeout> } | null = null;
let pendingEnter: { timer: ReturnType<typeof setTimeout> } | null = null;
let indicatorHost: HTMLDivElement | null = null;

const listeners: [keyof DocumentEventMap, (event: Event) => void][] = [
  ['click', onClick],
  ['input', onInput],
  ['change', onChange],
  ['focusout', onFocusOut],
  ['keydown', onKeyDown],
  ['submit', onSubmit],
];

/** Starts/stops capture on the message from the background. Frames other than the top one are ignored. */
export function registerWorkflowRecorder(): void {
  chrome.runtime.onMessage.addListener((message: IndicatorMessage, sender) => {
    if (sender.id !== chrome.runtime.id || window.top !== window) return false;
    if (message?.type === START_MESSAGE) startCapture(message);
    if (message?.type === STOP_MESSAGE) stopCapture();
    return false;
  });
}

// The background sends the localized indicator labels, so this bundle does not need the i18n package.
interface IndicatorMessage {
  type?: unknown;
  text?: unknown;
  stopText?: unknown;
}

function startCapture(message: IndicatorMessage): void {
  if (active) return;
  active = true;
  for (const [type, handler] of listeners) document.addEventListener(type, handler, true);
  showIndicator(
    typeof message.text === 'string' ? message.text : 'Recording',
    typeof message.stopText === 'string' ? message.stopText : 'Stop',
  );
}

function stopCapture(): void {
  if (!active) return;
  flushText();
  clearPendingEnter();
  for (const [type, handler] of listeners) document.removeEventListener(type, handler, true);
  active = false;
  hideIndicator();
}

function sendStep(step: RecordedStep): void {
  chrome.runtime.sendMessage({ type: STEP_MESSAGE, step }).catch(() => undefined);
}

function isOwnUi(target: EventTarget | null): boolean {
  // The overlay and the indicator use closed shadow roots, so events from inside them retarget to their host.
  return target instanceof Element && (target.id === OVERLAY_HOST_ID || target.id === INDICATOR_HOST_ID);
}

function isTextField(element: Element): element is TextField {
  if (element instanceof HTMLTextAreaElement) return true;
  return element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type.toLowerCase());
}

function onClick(event: Event): void {
  if (!event.isTrusted || !(event.target instanceof Element) || isOwnUi(event.target)) return;
  // Clicks in text fields, selects and textareas are recorded as type/select steps instead.
  if (isTextField(event.target) || event.target instanceof HTMLSelectElement) return;
  const target = event.target.closest('a,button,input,label,summary,[role="button"],[role="link"],[role="checkbox"]');
  const element = target ?? event.target;
  if (!(element instanceof Element) || isTextField(element)) return;
  sendStep({ kind: 'click', url: location.href, element: describeElement(element), at: Date.now() });
}

function onInput(event: Event): void {
  if (!event.isTrusted || !(event.target instanceof Element) || !isTextField(event.target)) return;
  if (pendingText && pendingText.field !== event.target) flushText();
  if (pendingText) clearTimeout(pendingText.timer);
  const field = event.target;
  pendingText = { field, timer: setTimeout(flushText, TYPE_SETTLE_MS) };
}

function onChange(event: Event): void {
  if (!event.isTrusted || !(event.target instanceof HTMLSelectElement)) return;
  const select = event.target;
  const option = select.selectedOptions[0];
  sendStep({
    kind: 'select',
    url: location.href,
    field: describeElement(select),
    value: pickElementName([option?.textContent]),
    at: Date.now(),
  });
}

function onFocusOut(event: Event): void {
  if (pendingText && event.target === pendingText.field) flushText();
}

function flushText(): void {
  if (!pendingText) return;
  const { field } = pendingText;
  clearTimeout(pendingText.timer);
  pendingText = null;
  const descriptor = describeElement(field);
  const fieldDescriptor: FieldDescriptor = {
    ...descriptor,
    inputType: field instanceof HTMLInputElement ? field.type.toLowerCase() : 'textarea',
    autocomplete: field.getAttribute('autocomplete') ?? '',
  };
  // Redaction runs here, before anything leaves the page: sensitive values are never sent.
  const { value, redacted } = redactTypedValue(field.value, fieldDescriptor);
  sendStep({ kind: 'type', url: location.href, field: descriptor, value, redacted, at: Date.now() });
}

function onKeyDown(event: Event): void {
  const keyboard = event as KeyboardEvent;
  if (!keyboard.isTrusted || keyboard.key !== 'Enter' || keyboard.isComposing) return;
  if (!(event.target instanceof HTMLInputElement) || !isTextField(event.target)) return;
  const field = event.target;
  if (field.form) {
    clearPendingEnter();
    // A submit event may follow; if it does, it records the step instead of this press.
    pendingEnter = {
      timer: setTimeout(() => {
        pendingEnter = null;
        sendStep({ kind: 'press', url: location.href, field: describeElement(field), key: 'Enter', at: Date.now() });
      }, ENTER_SUBMIT_WINDOW_MS),
    };
    return;
  }
  sendStep({ kind: 'press', url: location.href, field: describeElement(field), key: 'Enter', at: Date.now() });
}

function onSubmit(event: Event): void {
  if (!event.isTrusted || !(event.target instanceof HTMLFormElement)) return;
  clearPendingEnter();
  // A submit button click is already recorded as a click; only Enter-driven or script submissions remain.
  if ((event as SubmitEvent).submitter) return;
  sendStep({ kind: 'submit', url: location.href, element: describeElement(event.target), at: Date.now() });
}

function clearPendingEnter(): void {
  if (!pendingEnter) return;
  clearTimeout(pendingEnter.timer);
  pendingEnter = null;
}

function typeIndexOf(element: Element): number {
  let index = 1;
  for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    if (sibling.tagName === element.tagName) index += 1;
  }
  return index;
}

function toSelectorNode(element: Element): SelectorNode {
  return {
    tagName: element.tagName.toLowerCase(),
    typeIndex: typeIndexOf(element),
    getAttribute: name => element.getAttribute(name),
    get parent() {
      return element.parentElement ? toSelectorNode(element.parentElement) : null;
    },
  };
}

function countMatches(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function inputRole(type: string): string {
  switch (type.toLowerCase()) {
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'button':
    case 'submit':
    case 'reset':
      return 'button';
    case 'range':
      return 'slider';
    // ARIA implicit roles; the target resolver uses the same mapping.
    case 'search':
      return 'searchbox';
    case 'number':
      return 'spinbutton';
    default:
      return 'textbox';
  }
}

function labelTextFor(element: Element): string | null {
  if (element.id) {
    const label = document.querySelector(`label[for="${escapeAttributeValue(element.id)}"]`);
    if (label?.textContent) return label.textContent.slice(0, MAX_TEXT_SAMPLE_CHARS);
  }
  return element.closest('label')?.textContent?.slice(0, MAX_TEXT_SAMPLE_CHARS) ?? null;
}

/** Role, best visible or accessible name, and a selector. Input values are never read here, except button captions. */
export function describeElement(element: Element): ElementDescriptor {
  const tag = element.tagName.toLowerCase();
  const input = element instanceof HTMLInputElement ? element : null;
  const role = element.getAttribute('role') ?? (input ? inputRole(input.type) : (ROLE_BY_TAG[tag] ?? tag));
  // Button-like inputs keep their caption in value; other input values are user data and are never read.
  const isButtonInput = input !== null && BUTTON_INPUT_TYPES.has(input.type.toLowerCase());
  const name = pickElementName([
    element.getAttribute('aria-label'),
    labelTextFor(element),
    element.getAttribute('title'),
    isButtonInput ? input.value : null,
    ['button', 'a', 'summary'].includes(tag) ? element.textContent?.slice(0, MAX_TEXT_SAMPLE_CHARS) : null,
    element.getAttribute('placeholder'),
    element.getAttribute('name'),
    element.id,
  ]);
  return { role, name, selector: buildElementSelector(toSelectorNode(element), countMatches) };
}

function showIndicator(text: string, stopText: string): void {
  if (indicatorHost) return;
  const host = document.createElement('div');
  host.id = INDICATOR_HOST_ID;
  host.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent =
    '.bar{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-radius:999px;background:#00843f;color:#fff;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)}' +
    '.dot{width:8px;height:8px;border-radius:50%;background:#fca5a5;animation:pulse 1.2s ease-in-out infinite}' +
    'button{border:0;border-radius:999px;padding:6px 12px;background:#fff;color:#00843f;font:inherit;cursor:pointer}' +
    'button:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
    '@keyframes pulse{50%{opacity:.3}}' +
    '@media (prefers-reduced-motion: reduce){.dot{animation:none}}';
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'status');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = text;
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.textContent = stopText;
  stop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: STOP_REQUEST_MESSAGE }).catch(() => undefined);
  });
  bar.append(dot, label, stop);
  root.append(style, bar);
  document.documentElement.appendChild(host);
  indicatorHost = host;
}

function hideIndicator(): void {
  indicatorHost?.remove();
  indicatorHost = null;
}
