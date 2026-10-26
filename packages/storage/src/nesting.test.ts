import { describe, expect, it } from 'vitest';
import { MAX_NESTING, nestedTooDeep } from './nesting.ts';

/** An array nested `depth` levels deep, as JSON.parse would give it. */
const nested = (depth: number) => JSON.parse('['.repeat(depth) + ']'.repeat(depth)) as unknown;

describe('nestedTooDeep', () => {
  it('counts levels of arrays and objects, not of plain values', () => {
    expect(nestedTooDeep('text', 0)).toBe(false);
    expect(nestedTooDeep({ a: 1, b: [2] }, 2)).toBe(false);
    expect(nestedTooDeep({ a: 1, b: [2] }, 1)).toBe(true);
    expect(nestedTooDeep(nested(MAX_NESTING))).toBe(false);
    expect(nestedTooDeep(nested(MAX_NESTING + 1))).toBe(true);
  });

  it('finds a deep part anywhere, and copes with any depth (audit 3 C-1)', () => {
    const item = { id: 'a', name: 'Olive oil', extra: { list: [1, nested(70)] } };
    expect(nestedTooDeep({ items: [{ id: 'b' }, item] })).toBe(true);
    // Deeper than the code that compares items could ever follow.
    expect(nestedTooDeep(nested(200_000))).toBe(true);
  });
});
