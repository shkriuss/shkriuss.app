import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  chooseEdits,
  correct,
  parseLabels,
  parseVerbForms,
  predictions,
  transform,
  type Prediction,
} from './gector.ts';

const data = (name: string) =>
  readFileSync(new URL(`../../deep-check/${name}`, import.meta.url), 'utf8');
const labels = parseLabels(data('labels.txt'));
const verbs = parseVerbForms(data('verb-form-vocab.txt'));
const label = (name: string) => labels.indexOf(name);

/** Cases worked out by the Python code that was tested on real essays (docs/adr/0012). */
interface Case {
  words: string[];
  found: [number, number][];
  expected: string[];
}
const cases = JSON.parse(data('fixtures/edits.json')) as Case[];

describe('labels and verb forms', () => {
  it('reads the model’s 5,002 labels in order', () => {
    expect(labels).toHaveLength(5002);
    expect(labels.slice(0, 3)).toEqual(['$KEEP', '$DELETE', '$TRANSFORM_CASE_CAPITAL']);
    expect(labels.at(-1)).toBe('@@PADDING@@');
  });

  it('reads verb forms', () => {
    expect(verbs.get('go_VB_VBZ')).toBe('goes');
    expect(verbs.get('goes_VBZ_VB')).toBe('go');
    expect(transform('go', '$TRANSFORM_VERB_VB_VBZ', verbs)).toBe('goes');
    expect(transform('zzz', '$TRANSFORM_VERB_VB_VBZ', verbs)).toBeUndefined();
  });

  it('changes letter case, singular and plural', () => {
    expect(transform('london', '$TRANSFORM_CASE_CAPITAL', verbs)).toBe('London');
    expect(transform('HELLO', '$TRANSFORM_CASE_LOWER', verbs)).toBe('hello');
    expect(transform('apples', '$TRANSFORM_AGREEMENT_SINGULAR', verbs)).toBe('apple');
    expect(transform('apple', '$TRANSFORM_AGREEMENT_PLURAL', verbs)).toBe('apples');
  });
});

describe('predictions', () => {
  it('finds the most likely label and how sure the model is', () => {
    // Two pieces, three labels each.
    const logits = new Float32Array([0, 0, 0, 1, 5, 1]);
    const [first, second] = predictions(logits, 3, [0, 1]);
    expect(first?.probability).toBeCloseTo(1 / 3);
    expect(second?.label).toBe(1);
    expect(second?.probability).toBeCloseTo(Math.exp(5) / (Math.exp(5) + 2 * Math.exp(1)));
  });
});

describe('chooseEdits and applyEdits', () => {
  it('match the tested Python code exactly', () => {
    expect(cases.length).toBeGreaterThan(100);
    for (const { words, found, expected } of cases) {
      const edits = chooseEdits(
        found.map(([number, probability]) => ({ label: number, probability })),
        labels,
      );
      expect(applyEdits(words, edits, verbs), words.join(' ')).toEqual(expected);
    }
  });

  it('leaves words that are names of an object’s own functions alone (audit 4 F3-2)', () => {
    // "constructor" and "toString" were taken for merge marks: joined to their
    // neighbours with "function Object() { [native code] }", or dropped.
    for (const word of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      const words = ['The', word, 'have', 'finished', '.'];
      const edits = [{ index: 2, label: '$REPLACE_has' }];
      expect(applyEdits(words, edits, verbs)).toEqual(['The', word, 'has', 'finished', '.']);
      expect(
        applyEdits(['My', 'uncle', 'is', 'a', word], [{ index: 2, label: '$REPLACE_is' }], verbs),
      ).toEqual(['My', 'uncle', 'is', 'a', word]);
    }
    // Real merge marks still merge.
    expect(
      applyEdits(['every', 'one', 'came'], [{ index: 0, label: '$MERGE_SPACE' }], verbs),
    ).toEqual(['everyone', 'came']);
    expect(
      applyEdits(['well', 'known', 'fact'], [{ index: 0, label: '$MERGE_HYPHEN' }], verbs),
    ).toEqual(['well-known', 'fact']);
  });

  it('only acts when the model is sure enough', () => {
    const found: Prediction[] = [
      { label: label('$KEEP'), probability: 0.99 },
      { label: label('$REPLACE_have'), probability: 0.69 },
      { label: label('$APPEND_an'), probability: 0.7 },
    ];
    expect(chooseEdits(found, labels)).toEqual([{ index: 1, label: '$APPEND_an' }]);
  });
});

describe('correct', () => {
  it('reads the sentence again until nothing changes', async () => {
    const seen: string[] = [];
    const predict = (words: readonly string[]): Promise<Prediction[]> => {
      seen.push(words.join(' '));
      const keep = { label: label('$KEEP'), probability: 0.99 };
      const found = [keep, ...words.map(() => keep)];
      if (words[1] === 'has') found[2] = { label: label('$REPLACE_have'), probability: 0.9 };
      else if (words[2] === 'a') found[3] = { label: label('$REPLACE_an'), probability: 0.9 };
      return Promise.resolve(found);
    };
    expect(await correct(['I', 'has', 'a', 'apple', '.'], predict, labels, verbs)).toEqual([
      'I',
      'have',
      'an',
      'apple',
      '.',
    ]);
    expect(seen).toEqual(['I has a apple .', 'I have a apple .', 'I have an apple .']);
  });
});
