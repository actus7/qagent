import type { HTTPRequest, HTTPResponse , Page as PuppeteerPage } from 'puppeteer-core/internal/puppeteer-core-browser.js';
import type { BrowserContextConfig } from './views';
import { createLogger } from '@src/background/log';

const logger = createLogger('Page');

const RELEVANT_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'iframe']);

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
  // Common CDNs
  'cloudfront.net',
  'fastly.net',
]);

type NetworkWaitConfig = Pick<BrowserContextConfig, 'waitForNetworkIdlePageLoadTime' | 'maximumWaitPageLoadTime'>;

/**
 * Resolves once the page has had no relevant network activity for `waitForNetworkIdlePageLoadTime` seconds,
 * or once `maximumWaitPageLoadTime` seconds have elapsed.
 */
export async function waitForStableNetwork(page: PuppeteerPage, config: NetworkWaitConfig): Promise<void> {
  const pendingRequests = new Set();
  let lastActivity = Date.now();

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
    if (Array.from(IGNORED_URL_PATTERNS).some(pattern => url.includes(pattern))) {
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

    pendingRequests.add(request);
    lastActivity = Date.now();
  };

  const onResponse = (response: HTTPResponse) => {
    const request = response.request();
    if (!pendingRequests.has(request)) {
      return;
    }

    // Filter by content type
    const contentType = response.headers()['content-type']?.toLowerCase() || '';

    // Skip streaming content
    if (
      ['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf'].some(t =>
        contentType.includes(t),
      )
    ) {
      pendingRequests.delete(request);
      return;
    }

    // Only process relevant content types
    if (!Array.from(RELEVANT_CONTENT_TYPES).some(ct => contentType.includes(ct))) {
      pendingRequests.delete(request);
      return;
    }

    // Skip large responses
    const contentLength = response.headers()['content-length'];
    if (contentLength && Number.parseInt(contentLength) > 5 * 1024 * 1024) {
      // 5MB
      pendingRequests.delete(request);
      return;
    }

    pendingRequests.delete(request);
    lastActivity = Date.now();
  };

  // Add event listeners
  page.on('request', onRequest);
  page.on('response', onResponse);

  try {
    const startTime = Date.now();

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 100));

      const now = Date.now();
      const timeSinceLastActivity = (now - lastActivity) / 1000; // Convert to seconds

      if (pendingRequests.size === 0 && timeSinceLastActivity >= config.waitForNetworkIdlePageLoadTime) {
        break;
      }

      const elapsedTime = (now - startTime) / 1000; // Convert to seconds
      if (elapsedTime > config.maximumWaitPageLoadTime) {
        logger.debug(
          `Network timeout after ${config.maximumWaitPageLoadTime}s with ${pendingRequests.size} pending requests:`,
          Array.from(pendingRequests).map(r => (r as HTTPRequest).url()),
        );
        break;
      }
    }
  } finally {
    // Clean up event listeners
    page.off('request', onRequest);
    page.off('response', onResponse);
  }
  logger.debug(`Network stabilized for ${config.waitForNetworkIdlePageLoadTime} seconds`);
}
