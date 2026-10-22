import type { KeyInput } from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import { createLogger } from '@src/background/log';

const logger = createLogger('Page');

const KEY_MAP: { [key: string]: string } = {
  // Letters
  a: 'KeyA',
  b: 'KeyB',
  c: 'KeyC',
  d: 'KeyD',
  e: 'KeyE',
  f: 'KeyF',
  g: 'KeyG',
  h: 'KeyH',
  i: 'KeyI',
  j: 'KeyJ',
  k: 'KeyK',
  l: 'KeyL',
  m: 'KeyM',
  n: 'KeyN',
  o: 'KeyO',
  p: 'KeyP',
  q: 'KeyQ',
  r: 'KeyR',
  s: 'KeyS',
  t: 'KeyT',
  u: 'KeyU',
  v: 'KeyV',
  w: 'KeyW',
  x: 'KeyX',
  y: 'KeyY',
  z: 'KeyZ',

  // Numbers
  '0': 'Digit0',
  '1': 'Digit1',
  '2': 'Digit2',
  '3': 'Digit3',
  '4': 'Digit4',
  '5': 'Digit5',
  '6': 'Digit6',
  '7': 'Digit7',
  '8': 'Digit8',
  '9': 'Digit9',

  // Special keys
  control: 'Control',
  shift: 'Shift',
  alt: 'Alt',
  meta: 'Meta',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
};

/**
 * Splits a key combination such as "Control+A" or "Shift+ArrowLeft" into its modifiers and main key.
 */
export function parseKeyCombination(keys: string): { modifiers: string[]; mainKey: string } {
  const keyParts = keys.split('+');
  return {
    modifiers: keyParts.slice(0, -1),
    mainKey: keyParts[keyParts.length - 1],
  };
}

/**
 * Maps a user-facing key name to a Puppeteer KeyInput.
 * On Mac, control/ctrl and command/cmd both map to Meta, and option/opt maps to Alt.
 */
export function convertKey(key: string, isMac: boolean): KeyInput {
  const lowerKey = key.trim().toLowerCase();

  if (isMac) {
    if (lowerKey === 'control' || lowerKey === 'ctrl') {
      return 'Meta' as KeyInput; // Use Command key on Mac
    }
    if (lowerKey === 'command' || lowerKey === 'cmd') {
      return 'Meta' as KeyInput; // Map Command/Cmd to Meta on Mac
    }
    if (lowerKey === 'option' || lowerKey === 'opt') {
      return 'Alt' as KeyInput; // Map Option/Opt to Alt on Mac
    }
  }

  const convertedKey = KEY_MAP[lowerKey] || key;
  logger.info('convertedKey', convertedKey);
  return convertedKey as KeyInput;
}

export function isMacUserAgent(): boolean {
  return navigator.userAgent.toLowerCase().includes('mac os x');
}
