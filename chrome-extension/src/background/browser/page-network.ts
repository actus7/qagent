import type {
  HTTPRequest,
  HTTPResponse,
  Page as PuppeteerPage,
} from 'puppeteer-core/internal/puppeteer-core-browser.js';
import type { BrowserContextConfig } from './views';
import { createLogger } from '@src/background/log';

const logger = createLogger('Page');

// xhr/fetch are included so SPA data loads after an action are waited for
const RELEVANT_RESOURCE_TYPES = new Set([
  'document',
  'stylesheet',
  'image',
  'font',
  'script',
  'iframe',
  'xhr',
  'fetch',
]);

// A request still pending after this long is treated as long-polling/streaming and no longer blocks idleness
const STALE_REQUEST_MS = 2000;

const RELEVANT_CONTENT_TYPES = new Set([
  'text/html',
  'text/css',
  'application/javascript',
  'image/',
  'font/',
  'application/json',
]);

const IGNORED_URL_PATTERNS = new Set([
  // Analytics and tracking
  'analytics',
  'tracking',
  'telemetry',
  'beacon',
  'metrics',
  // Ad-related
  'doubleclick',
  'adsystem',
  'adserver',
  'advertising',
  // Social media widgets
  'facebook.com/plugins',
  'platform.twitter',
  'linkedin.com/embed',
  // Live chat and support
  'livechat',
  'zendesk',
  'intercom',
  'crisp.chat',
  'hotjar',
  // Push notifications
  'push-notifications',
  'onesignal',
  'pushwoosh',
  // Background sync/heartbeat
  'heartbeat',
  'ping',
  'alive',
  // WebRTC and streaming
  'webrtc',
  'rtmp://',
  'wss://',
]);

/**
 * True when the URL matches an ignored pattern. Plain words must equal a whole URL token
 * ("ping" matches `/ping` but not `/shopping`); patterns with punctuation match as substrings.
 */
export function isIgnoredUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  const tokens = new Set(url.split(/[^a-z0-9]+/));
  for (const pattern of IGNORED_URL_PATTERNS) {
    if (/^[a-z0-9]+$/.test(pattern) ? tokens.has(pattern) : url.includes(pattern)) return true;
  }
  return false;
}

type NetworkWaitConfig = Pick<BrowserContextConfig, 'waitForNetworkIdlePageLoadTime' | 'maximumWaitPageLoadTime'>;

/**
 * Resolves once the page has had no relevant network activity for `waitForNetworkIdlePageLoadTime` seconds,
 * or once `maximumWaitPageLoadTime` seconds have elapsed.
 */
export async function waitForStableNetwork(page: PuppeteerPage, config: NetworkWaitConfig): Promise<void> {
  // request -> time it started
  const pendingRequests = new Map<HTTPRequest, number>();
  // Start almost idle: a page with no new request in the first ~150 ms is already stable and must not pay the full idle window
  let lastActivity = Date.now() - Math.max(0, config.waitForNetworkIdlePageLoadTime * 1000 - 150);

  const onRequest = (request: HTTPRequest) => {
    // Filter by resource type
    const resourceType = request.resourceType();
    if (!RELEVANT_RESOURCE_TYPES.has(resourceType)) {
      return;
    }

    // Filter out streaming, websocket, and other real-time requests
    if (['websocket', 'media', 'eventsource', 'manifest', 'other'].includes(resourceType)) {
      return;
    }

    // Filter out by URL patterns
    const url = request.url().toLowerCase();
    if (isIgnoredUrl(url)) {
      return;
    }

    // Filter out data URLs and blob URLs
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return;
    }

    // Filter out requests with certain headers
    const headers = request.headers();
    if (
      // biome-ignore lint/complexity/useLiteralKeys: <explanation>
      headers['purpose'] === 'prefetch' ||
      headers['sec-fetch-dest'] === 'video' ||
      headers['sec-fetch-dest'] === 'audio'
    ) {
      return;
    }

    pendingRequests.set(request, Date.now());
    lastActivity = Date.now();
  };

  // A failed/aborted request never gets a response; without this it would hold the wait until the maximum
  const onRequestDone = (request: HTTPRequest) => {
    if (pendingRequests.delete(request)) lastActivity = Date.now();
  };

  const onResponse = (response: HTTPResponse) => {
    const request = response.request();
    if (!pendingRequests.has(request)) {
      return;
    }
    // Every outcome below settles this request, so it leaves the pending set up front
    pendingRequests.delete(request);

    // Filter by content type
    const contentType = response.headers()['content-type']?.toLowerCase() || '';

    // Skip streaming content
    if (
      ['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf'].some(t =>
        contentType.includes(t),
      )
    ) {
      return;
    }

    // Only process relevant content types
    if (!Array.from(RELEVANT_CONTENT_TYPES).some(ct => contentType.includes(ct))) {
      return;
    }

    // Skip large responses
    const contentLength = response.headers()['content-length'];
    if (contentLength && Number.parseInt(contentLength) > 5 * 1024 * 1024) {
      // 5MB
      return;
    }

    lastActivity = Date.now();
  };

  // Add event listeners
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestDone);
  page.on('requestfinished', onRequestDone);

  try {
    const startTime = Date.now();

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const now = Date.now();
      const timeSinceLastActivity = (now - lastActivity) / 1000; // Convert to seconds

      let activeRequests = 0;
      for (const startedAt of pendingRequests.values()) if (now - startedAt < STALE_REQUEST_MS) activeRequests++;

      if (activeRequests === 0 && timeSinceLastActivity >= config.waitForNetworkIdlePageLoadTime) {
        break;
      }

      const elapsedTime = (now - startTime) / 1000; // Convert to seconds
      if (elapsedTime > config.maximumWaitPageLoadTime) {
        logger.debug(
          `Network timeout after ${config.maximumWaitPageLoadTime}s with ${pendingRequests.size} pending requests:`,
          Array.from(pendingRequests.keys()).map(r => r.url()),
        );
        break;
      }
    }
  } finally {
    // Clean up event listeners
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestDone);
    page.off('requestfinished', onRequestDone);
  }
  logger.debug(`Network stabilized for ${config.waitForNetworkIdlePageLoadTime} seconds`);
}
