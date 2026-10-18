import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Bpe, END_ID, MAX_PIECES, START_ID } from './bpe.ts';

const data = (name: string) =>
  readFileSync(new URL(`../../deep-check/${name}`, import.meta.url), 'utf8');
const bpe = new Bpe(JSON.parse(data('vocab.json')) as Record<string, number>, data('merges.txt'));
/** The ids Hugging Face's tokenizer gives each word (with a space before it). */
const expected = JSON.parse(data('fixtures/bpe.json')) as Record<string, number[]>;

describe('Bpe', () => {
  it('gives exactly the ids of the tokenizer the model was trained with', () => {
    const words = Object.keys(expected).filter((word) => word !== '$START');
    expect(words.length).toBeGreaterThan(700);
    for (const word of words) expect(bpe.encode(` ${word}`), word).toEqual(expected[word]);
    expect(bpe.encode('$START')).toEqual(expected['$START']);
  });

  it('reads a sentence as GECToR does', () => {
    const { ids, starts, count } = bpe.encodeWords(['I', 'has', 'apples', '.']);
    const start = expected['$START'] ?? [];
    expect(ids[0]).toBe(START_ID);
    expect(ids.at(-1)).toBe(END_ID);
    expect(starts[0]).toBe(1);
    expect(starts).toHaveLength(5);
    expect(count).toBe(4);
    // Each word's first piece is where `starts` says.
    expect(ids.slice(1, 1 + start.length)).toEqual(start);
    expect(ids[starts[2] ?? 0]).toBe(bpe.encode(' has')[0]);
  });

  it('leaves out words that don’t fit', () => {
    const words = Array.from({ length: 600 }, () => 'apple');
    const { ids, starts, count } = bpe.encodeWords(words);
    expect(ids.length).toBeLessThanOrEqual(MAX_PIECES + 2);
    expect(count).toBeLessThan(600);
    expect(starts).toHaveLength(count + 1);
  });
});
