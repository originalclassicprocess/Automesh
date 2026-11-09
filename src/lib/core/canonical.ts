export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const OBJECT_MAX_BYTES = 64 * 1024;
const MAX_DEPTH = 16;
const MAX_NODES = 4096;

// Automesh JSON v1, NOT an implementation of RFC 8785. Key ordering is JS
// UTF-16 sort, finite JSON numbers, no getters/prototypes/toJSON. Version this
// encoding rather than changing bytes of already-signed records.
export function canonicalJson(value: unknown): string {
  let nodes = 0;
  let budget = 0;
  const visiting = new Set<object>();
  const charge = (part: string) => {
    budget += new TextEncoder().encode(part).length;
    if (budget > OBJECT_MAX_BYTES) throw new Error('object_size_limit');
    return part;
  };
  const visit = (item: unknown, depth: number): string => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('object_complexity_limit');
    if (item === null) return charge('null');
    if (typeof item === 'boolean') return charge(item ? 'true' : 'false');
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('invalid_json_number');
      return charge(JSON.stringify(item));
    }
    if (typeof item === 'string') {
      if (item.length > OBJECT_MAX_BYTES) throw new Error('object_size_limit');
      return charge(JSON.stringify(item));
    }
    if (!item || typeof item !== 'object' || visiting.has(item)) throw new Error('invalid_json_value');
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new Error('invalid_json_value');
    visiting.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > MAX_NODES || Reflect.ownKeys(item).length !== item.length + 1) throw new Error('invalid_json_array');
        const values: string[] = [];
        charge('[]');
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !('value' in descriptor)) throw new Error('invalid_json_array');
          if (index) charge(',');
          values.push(visit(descriptor.value, depth + 1));
        }
        return '[' + values.join(',') + ']';
      }
      const keys = Reflect.ownKeys(item);
      if (keys.length > MAX_NODES || keys.some(key => typeof key !== 'string')) throw new Error('invalid_json_object');
      charge('{}');
      const parts: string[] = [];
      for (const key of (keys as string[]).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !('value' in descriptor) || ['__proto__', 'prototype', 'constructor'].includes(key))
          throw new Error('invalid_json_object');
        if (key.length > 256) throw new Error('invalid_json_key');
        if (parts.length) charge(',');
        parts.push(charge(JSON.stringify(key)) + charge(':') + visit(descriptor.value, depth + 1));
      }
      return '{' + parts.join(',') + '}';
    } finally { visiting.delete(item); }
  };
  return visit(value, 0);
}

export function jsonSnapshot<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
