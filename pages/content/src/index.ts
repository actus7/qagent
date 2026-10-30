import overlayStyles from './overlay.css?inline';
import { glideDurationMs, glideFrame, type AgentPoint } from '@extension/shared/lib/utils/agent-motion';
import { registerWorkflowRecorder } from './workflowRecorder';
import { registerMonitorWatcher } from './monitor';

type OverlayMode = 'running' | 'paused' | 'approval';

interface OverlayMessage {
  type:
    | 'qagent:overlay:show'
    | 'qagent:overlay:hide'
    | 'qagent:overlay:status'
    | 'qagent:overlay:ripple'
    | 'qagent:overlay:state'
    | 'qagent:overlay:pointer'
    | 'qagent:overlay:mode';
  text?: string;
  x?: number;
  y?: number;
  mode?: OverlayMode;
  driver?: string;
}

// Pointer tip sits at the top-left of the arrow glyph (see the SVG in createOverlay).
const CURSOR_TIP_X = 5;
const CURSOR_TIP_Y = 4;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
// Fade in on show and out on hide; the host is removed only after the fade-out.
const OVERLAY_FADE_MS = 300;

let shadowHost: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let statusTextEl: HTMLSpanElement | null = null;
let borderEl: HTMLDivElement | null = null;
let cursorEl: HTMLDivElement | null = null;
// Last rendered cursor point; the next glide starts here.
let cursorPoint: AgentPoint | null = null;
// Incremented per glide so a newer pointer message cancels the one in flight.
let glideToken = 0;
// Pending removal after a fade-out; cleared when the overlay is shown again before it finishes.
let removeTimer: ReturnType<typeof setTimeout> | null = null;

function createOverlay(): void {
  if (shadowHost) {
    cancelRemoval();
    shadowHost.style.opacity = '1';
    return;
  }

  shadowHost = document.createElement('div');
  shadowHost.id = 'qagent-overlay-host';
  shadowHost.style.transition = `opacity ${OVERLAY_FADE_MS}ms ease`;
  shadowHost.style.opacity = '0';
  shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

  // Inject styles
  const style = document.createElement('style');
  style.textContent = overlayStyles;
  shadowRoot.appendChild(style);

  // Glow border; data-mode drives paused (frozen) and approval (amber) looks
  borderEl = document.createElement('div');
  borderEl.className = 'qagent-border';
  borderEl.dataset.mode = 'running';
  shadowRoot.appendChild(borderEl);

  // Agent cursor: hidden until the first pointer message, never receives pointer events
  cursorEl = document.createElement('div');
  cursorEl.className = 'qagent-agent-cursor';
  cursorEl.setAttribute('aria-hidden', 'true');
  cursorEl.innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 3v16l4.6-4.2 3 6.2 2.6-1.3-3-6.1H17z"/></svg>`;
  shadowRoot.appendChild(cursorEl);

  // A page-wide input lock would also intercept trusted CDP mouse events sent by the agent.
  // Keep the indicator transparent to input; only the stop control receives pointer events.

  // Status bar
  const statusBar = document.createElement('div');
  statusBar.className = 'qagent-status-bar';

  // Spinner icon
  const iconWrap = document.createElement('div');
  iconWrap.className = 'qagent-status-icon';
  const spinner = document.createElement('div');
  spinner.className = 'qagent-spinner';
  iconWrap.appendChild(spinner);
  statusBar.appendChild(iconWrap);

  // Status text
  statusTextEl = document.createElement('span');
  statusTextEl.className = 'qagent-status-text';
  statusTextEl.textContent = '';
  statusBar.appendChild(statusTextEl);

  // Stop button
  const stopBtn = document.createElement('button');
  stopBtn.className = 'qagent-stop-btn';
  stopBtn.title = 'Stop agent';
  stopBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'qagent:cancel' }).catch(() => undefined);
  });
  statusBar.appendChild(stopBtn);

  shadowRoot.appendChild(statusBar);

  document.documentElement.appendChild(shadowHost);
  // Read a layout property so the hidden host is styled first; otherwise the fade-in has no start state.
  void shadowHost.offsetHeight;
  shadowHost.style.opacity = '1';
}

function cancelRemoval(): void {
  if (removeTimer === null) return;
  clearTimeout(removeTimer);
  removeTimer = null;
}

function destroyOverlay(): void {
  if (!shadowHost || removeTimer !== null) return;
  shadowHost.style.opacity = '0';
  removeTimer = setTimeout(removeOverlay, OVERLAY_FADE_MS);
}

function removeOverlay(): void {
  removeTimer = null;
  shadowHost?.remove();
  shadowHost = null;
  shadowRoot = null;
  statusTextEl = null;
  borderEl = null;
  cursorEl = null;
  cursorPoint = null;
  glideToken++;
}

/** Sets who drives the page; the overlay CSS derives its colours from this (see overlay.css). */
function updateDriver(driver: string | undefined): void {
  if (shadowHost && driver) {
    shadowHost.dataset.driver = driver;
  }
}

function updateStatus(text: string): void {
  if (statusTextEl) {
    statusTextEl.textContent = text;
  }
}

function updateMode(mode: OverlayMode): void {
  if (borderEl) {
    borderEl.dataset.mode = mode;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

function placeCursor(point: AgentPoint): void {
  if (!cursorEl) return;
  cursorEl.style.transform = `translate3d(${point.x - CURSOR_TIP_X}px, ${point.y - CURSOR_TIP_Y}px, 0)`;
  cursorEl.classList.add('is-visible');
  cursorPoint = point;
}

/**
 * Glides the cursor along the curved path; `onSettle(true)` runs once it is on the target, `onSettle(false)`
 * when a newer glide or the overlay teardown cancels it. Reduced motion jumps.
 */
function moveCursorTo(target: AgentPoint, onSettle: (arrived: boolean) => void): void {
  const token = ++glideToken;
  const from = cursorPoint;
  if (!from || prefersReducedMotion()) {
    placeCursor(target);
    onSettle(true);
    return;
  }

  const durationMs = glideDurationMs(from, target);
  const startedAt = performance.now();
  const step = (now: number): void => {
    if (token !== glideToken) {
      onSettle(false);
      return;
    }
    const { point, done } = glideFrame(from, target, now - startedAt, durationMs);
    placeCursor(point);
    if (done) {
      onSettle(true);
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function createRipple(x: number, y: number): void {
  if (!shadowRoot) return;

  // Main ripple
  const ripple = document.createElement('div');
  ripple.className = 'qagent-ripple';
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  shadowRoot.appendChild(ripple);

  // Ring ripple
  const ring = document.createElement('div');
  ring.className = 'qagent-ripple-ring';
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  shadowRoot.appendChild(ring);

  // Cleanup after animation
  setTimeout(() => {
    ripple.remove();
    ring.remove();
  }, 700);
}

interface OverlayStateResponse {
  active?: boolean;
  statusText?: string | null;
  mode?: OverlayMode;
  driver?: string;
}

async function syncOverlayStateFromBackground(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'qagent:overlay:state',
    } as OverlayMessage)) as OverlayStateResponse | undefined;

    if (!response?.active) {
      destroyOverlay();
      return;
    }

    createOverlay();
    updateDriver(response.driver);
    if (response.statusText) {
      updateStatus(response.statusText);
    }
    if (response.mode) {
      updateMode(response.mode);
    }
  } catch {
    // Background may be unavailable momentarily while service worker spins up.
  }
}

// Listen for messages from the background service
chrome.runtime.onMessage.addListener((message: OverlayMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'qagent:overlay:show':
      createOverlay();
      updateDriver(message.driver);
      break;
    case 'qagent:overlay:hide':
      destroyOverlay();
      break;
    case 'qagent:overlay:status':
      if (message.text) {
        updateStatus(message.text);
      }
      break;
    case 'qagent:overlay:ripple':
      if (message.x !== undefined && message.y !== undefined) {
        createRipple(message.x, message.y);
      }
      break;
    case 'qagent:overlay:mode':
      if (message.mode) {
        updateMode(message.mode);
      }
      break;
    case 'qagent:overlay:pointer': {
      // The background sends this to every frame of the tab; only the top frame draws the cursor.
      if (window.top !== window) return false;
      if (message.x === undefined || message.y === undefined) return false;
      // A tab the agent just opened or switched to may not have the overlay yet; the cursor must still show.
      createOverlay();
      const target = { x: message.x, y: message.y };
      moveCursorTo(target, arrived => {
        // Ripple where the cursor actually landed (after scrolling), so the click is seen on the target
        if (arrived) createRipple(target.x, target.y);
        // A superseded glide still answers, or the sender's action waits on a reply that never comes
        sendResponse({ ok: true });
      });
      // Reply after the glide finishes, so the action starts once the cursor has arrived.
      return true;
    }
  }
  sendResponse({ ok: true });
  return false;
});

registerWorkflowRecorder();
registerMonitorWatcher();
void syncOverlayStateFromBackground();

console.log('[QAgent] Content script loaded');
