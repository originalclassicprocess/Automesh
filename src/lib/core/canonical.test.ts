import { describe, expect, it } from 'vitest';
import { canonicalJson, OBJECT_MAX_BYTES } from './canonical';

describe('Automesh JSON v1', () => {
  it('has stable bytes regardless of object insertion order', () => {
    expect(canonicalJson({ z: [true, null, -0], a: { b: 'кириллица', a: 1 } }))
      .toBe('{"a":{"a":1,"b":"кириллица"},"z":[true,null,0]}');
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(canonicalJson(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
  });
  it('never invokes accessors or toJSON', () => {
    let invoked = false;
    const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { invoked = true; return 1; } });
    expect(() => canonicalJson(accessor)).toThrow('invalid_json_object');
    expect(() => canonicalJson({ toJSON() { invoked = true; return {}; } })).toThrow();
    const array = Object.defineProperty([1], '0', { get() { invoked = true; return 1; } });
    expect(() => canonicalJson(array)).toThrow('invalid_json_array');
    expect(invoked).toBe(false);
  });
  it.each([undefined, NaN, Infinity, -Infinity, 1n, new Date(), new Map(), new Uint8Array(1), () => 1])
    ('rejects non-JSON values (%s)', value => expect(() => canonicalJson(value)).toThrow());
  it('rejects hidden keys, symbols, polluted keys, holes and decorated arrays', () => {
    const decorated = [1]; Object.assign(decorated, { extra: 1 });
    for (const value of [Object.defineProperty({}, 'x', { value: 1 }), { [Symbol('x')]: 1 },
      JSON.parse('{"__proto__":{}}'), { constructor: 1 }, { prototype: 1 }, new Array(2), decorated,
      Object.create(Array.prototype)]) expect(() => canonicalJson(value)).toThrow();
  });
  it('bounds encoded bytes, depth, width and detects cycles', () => {
    expect(() => canonicalJson('x'.repeat(OBJECT_MAX_BYTES))).toThrow('object_size_limit');
    expect(() => canonicalJson('я'.repeat(OBJECT_MAX_BYTES / 2))).toThrow('object_size_limit');
    expect(() => canonicalJson(new Array(4097).fill(0))).toThrow();
    let deep: unknown = 1; for (let i = 0; i < 18; i++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow('object_complexity_limit');
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(() => canonicalJson(cycle)).toThrow('invalid_json_value');
    const shared = { a: 1 }; expect(canonicalJson([shared, shared])).toBe('[{"a":1},{"a":1}]');
  });
});
