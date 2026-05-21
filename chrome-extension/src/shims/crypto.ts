function fallbackRandomUUID(webcrypto: Crypto): string {
  const bytes = new Uint8Array(16);
  webcrypto.getRandomValues(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

const webcrypto = globalThis.crypto;

if (!webcrypto) {
  throw new Error('Web Crypto API is unavailable');
}

export { webcrypto };

export function randomUUID(): string {
  if (typeof webcrypto.randomUUID === 'function') {
    return webcrypto.randomUUID();
  }

  return fallbackRandomUUID(webcrypto);
}

export default {
  webcrypto,
  randomUUID,
};
