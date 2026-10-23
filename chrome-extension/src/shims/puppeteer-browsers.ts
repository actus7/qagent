// puppeteer-core lazily imports '@puppeteer/browsers' (directly and via node/LaunchOptions.js) only on its Node
// launch path (`options.channel && isNode`). The extension never takes that path, so this stub keeps the
// Node-only package out of the bundle while satisfying the names Rollup resolves statically.
const nodeOnly = (): never => {
  throw new Error('@puppeteer/browsers is not available in the extension runtime');
};

export const ChromeReleaseChannel = { STABLE: 'stable', DEV: 'dev', BETA: 'beta', CANARY: 'canary' } as const;
export const Browser = { CHROME: 'chrome', CHROMIUM: 'chromium', FIREFOX: 'firefox' } as const;
export const detectBrowserPlatform = nodeOnly;
export const resolveDefaultUserDataDir = nodeOnly;
