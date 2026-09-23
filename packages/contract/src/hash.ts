/**
 * Canonical serialisation and hashing.
 *
 * Two things depend on this being exactly stable:
 *
 * - the **done gate** (ARCHITECTURE §7.8): publish is refused unless the current
 *   `SiteDefinition` hash equals the hash the green gate report was produced for;
 * - the **model-call memo** (§5): the key is a hash of the eligible set, the prompt fragments
 *   and the seed, with the model id deliberately excluded.
 *
 * Both break silently if key order or number formatting can drift, so serialisation sorts
 * object keys and rejects values JSON cannot represent faithfully.
 */
import { createHash } from 'node:crypto';

export class NonCanonicalValueError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} at ${path || '<root>'}`);
    this.name = 'NonCanonicalValueError';
  }
}

/**
 * Deterministic JSON: object keys sorted, arrays in order, `undefined` object properties
 * dropped. Throws on values whose JSON round trip would not be faithful, rather than emitting
 * something that hashes differently on the way back.
 */
export function canonicalJson(value: unknown, path = ''): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new NonCanonicalValueError(`non-finite number ${String(value)}`, path);
      }
      // `-0` and `0` are the same value to a reader and must hash the same.
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      throw new NonCanonicalValueError('undefined is not representable', path);
    case 'bigint':
      throw new NonCanonicalValueError('bigint is not representable', path);
    case 'function':
    case 'symbol':
      throw new NonCanonicalValueError(`${typeof value} is not representable`, path);
  }

  if (Array.isArray(value)) {
    const items = value.map((item, index) =>
      item === undefined ? 'null' : canonicalJson(item, `${path}[${index}]`),
    );
    return `[${items.join(',')}]`;
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = record[key];
    if (child === undefined) continue; // matches JSON.stringify: absent, not null
    parts.push(`${JSON.stringify(key)}:${canonicalJson(child, path ? `${path}.${key}` : key)}`);
  }
  return `{${parts.join(',')}}`;
}

/** SHA-256 of the canonical serialisation, hex encoded. */
export function stableHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** The first 16 hex characters — enough to key a memo or name a snapshot file. */
export function shortHash(value: unknown): string {
  return stableHash(value).slice(0, 16);
}
