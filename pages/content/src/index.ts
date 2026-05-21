import overlayStyles from './overlay.css?inline';

interface OverlayMessage {
    type:
    | 'qagent:overlay:show'
    | 'qagent:overlay:hide'
    | 'qagent:overlay:status'
    | 'qagent:overlay:ripple'
    | 'qagent:overlay:state';
    text?: string;
    x?: number;
    y?: number;
}

let shadowHost: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let statusTextEl: HTMLSpanElement | null = null;

function createOverlay(): void {
    if (shadowHost) return;

    shadowHost = document.createElement('div');
    shadowHost.id = 'qagent-overlay-host';
    shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = overlayStyles;
    shadowRoot.appendChild(style);

    // Wave border
    const border = document.createElement('div');
    border.className = 'qagent-border';
    shadowRoot.appendChild(border);

    // Lock overlay
    const lock = document.createElement('div');
    lock.className = 'qagent-lock';
    lock.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    lock.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    lock.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    shadowRoot.appendChild(lock);

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
        chrome.runtime.sendMessage({ type: 'qagent:cancel' });
    });
    statusBar.appendChild(stopBtn);

    shadowRoot.appendChild(statusBar);

    document.documentElement.appendChild(shadowHost);
}

function destroyOverlay(): void {
    if (shadowHost) {
        shadowHost.remove();
        shadowHost = null;
        shadowRoot = null;
        statusTextEl = null;
    }
}

function updateStatus(text: string): void {
    if (statusTextEl) {
        statusTextEl.textContent = text;
    }
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
        if (response.statusText) {
            updateStatus(response.statusText);
        }
    } catch {
        // Background may be unavailable momentarily while service worker spins up.
    }
}

// Listen for messages from the background service
chrome.runtime.onMessage.addListener(
    (message: OverlayMessage, _sender, sendResponse) => {
        switch (message.type) {
            case 'qagent:overlay:show':
                createOverlay();
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
        }
        sendResponse({ ok: true });
        return false;
    },
);

void syncOverlayStateFromBackground();

console.log('[QAgent] Content script loaded');
