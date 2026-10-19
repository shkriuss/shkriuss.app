import { describe, expect, it } from 'vitest';
import { MAX_SENTENCE_WORDS, sentencesOf, wordsOf } from './sentences.ts';

const read = (text: string) => sentencesOf(text).map((s) => s.words.map((w) => w.model));

describe('wordsOf', () => {
  it('splits punctuation and short forms as the model expects', () => {
    expect(wordsOf("I can't, won't and cannot do it.").map((w) => w.model)).toEqual([
      'I',
      'ca',
      "n't",
      ',',
      'wo',
      "n't",
      'and',
      'can',
      'not',
      'do',
      'it',
      '.',
    ]);
    expect(wordsOf("it's John's and the students' job").map((w) => w.model)).toEqual([
      'it',
      "'s",
      'John',
      "'s",
      'and',
      'the',
      'students',
      "'",
      'job',
    ]);
    expect(wordsOf('A well-known (and loved) e-mail…').map((w) => w.model)).toEqual([
      'A',
      'well',
      '-',
      'known',
      '(',
      'and',
      'loved',
      ')',
      'e',
      '-',
      'mail',
      '…',
    ]);
  });

  it('keeps abbreviations, numbers, links and email addresses whole', () => {
    expect(wordsOf('Mr. Lee, e.g. 3.5 p.m. in the U.S. costs $5,000 (10%).').map((w) => w.model))
      .toEqual(['Mr.', 'Lee', ',', 'e.g.', '3.5', 'p.m.', 'in', 'the', 'U.S.', 'costs', '$', '5,000', '(', '10', '%', ')', '.']); // prettier-ignore
    expect(
      wordsOf('See https://example.com/a?b=c, or me@example.com.').map((w) => w.model),
    ).toEqual(['See', 'https://example.com/a?b=c', ',', 'or', 'me@example.com', '.']);
  });

  it('reads curly quotes as straight ones, but keeps their place in the text', () => {
    const text = 'He said “it’s fine”.';
    const words = wordsOf(text);
    expect(words.map((w) => w.model)).toEqual(['He', 'said', '"', 'it', "'s", 'fine', '"', '.']);
    for (const word of words) expect(text.slice(word.start, word.end)).toBe(word.text);
    expect(words[4]).toMatchObject({ text: '’s', model: "'s" });
  });

  it('counts positions like JavaScript strings, also after emoji', () => {
    const text = 'Wow 🙂 she go home.';
    const go = wordsOf(text).find((word) => word.text === 'go');
    expect(go && text.slice(go.start, go.end)).toBe('go');
  });
});

describe('sentencesOf', () => {
  it('ends sentences after full stops, question and exclamation marks', () => {
    expect(read('I has a apple. Me and him went! Did you? yes.')).toEqual([
      ['I', 'has', 'a', 'apple', '.'],
      ['Me', 'and', 'him', 'went', '!'],
      ['Did', 'you', '?', 'yes', '.'],
    ]);
  });

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(read('"Wow." She left (quickly.) Then we ate.')).toEqual([
      ['"', 'Wow', '.', '"'],
      ['She', 'left', '(', 'quickly', '.', ')'],
      ['Then', 'we', 'ate', '.'],
    ]);
  });

  it('doesn’t end a sentence after an abbreviation like “Mr.”', () => {
    expect(read('Mr. Smith and Dr. Who met at 5 p.m. today.')).toHaveLength(1);
  });

  it('ends a sentence at a line break, and skips lines without words', () => {
    expect(read('line one\nline two\n\n---\n- a point')).toEqual([
      ['line', 'one'],
      ['line', 'two'],
      ['-', 'a', 'point'],
    ]);
  });

  it('knows where each sentence is', () => {
    const text = '  First one.  Second one.';
    expect(sentencesOf(text).map((s) => text.slice(s.start, s.end))).toEqual([
      'First one.',
      'Second one.',
    ]);
  });

  it('checks very long sentences in pieces, at a comma when it can', () => {
    const long = Array.from({ length: 100 }, (_, index) => (index === 59 ? 'word,' : 'word')).join(
      ' ',
    );
    const pieces = read(long);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.at(-1)).toBe(',');
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(MAX_SENTENCE_WORDS);
  });
});
