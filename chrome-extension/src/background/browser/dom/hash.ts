const FNV_PRIME = 0x01000193;
// Two FNV-1a passes with different offset bases give a 64-bit digest, so equal-looking elements rarely collide
const OFFSET_BASES = [0x811c9dc5, 0x050c5d1f];

/**
 * Digest used to tell DOM elements apart between page reads. Only equality matters, so a cheap synchronous
 * hash replaces SHA-256: Web Crypto cost an async round trip per element and per hashed field.
 */
/** Attributes as one string (`key=value` pairs, in order), the input both element hashes digest. */
export function serializeAttributes(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join('');
}

export function hashText(input: string): string {
  return OFFSET_BASES.map(basis => {
    let hash = basis;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, FNV_PRIME);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
}
