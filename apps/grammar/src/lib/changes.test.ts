import { describe, expect, it } from 'vitest';
import {
  applyAll,
  applyChange,
  changeDone,
  changeLabel,
  changesSummary,
  keptWords,
  remainingAfter,
  sentenceChanges,
  written,
  type Change,
} from './changes.ts';
import { sentencesOf } from './sentences.ts';

/** The changes for a one-sentence text, given the model's corrected words. */
function changesFor(text: string, corrected: string): Change[] {
  const [sentence] = sentencesOf(text);
  if (!sentence) throw new Error('no sentence');
  return sentenceChanges(text, sentence, corrected.split(' '));
}
const fixed = (text: string, corrected: string) => applyAll(text, changesFor(text, corrected));

describe('keptWords and written', () => {
  it('finds the words that stay', () => {
    expect(keptWords(['I', 'has', 'a', 'apple'], ['I', 'have', 'an', 'apple'])).toEqual([
      [0, 0],
      [3, 3],
    ]);
  });

  it('writes words with normal spacing', () => {
    expect(written(['do', "n't", ',', 'he', "'s", '(', 'ok', ')', '.'])).toBe("don't, he's (ok).");
    expect(written(['well', '-', 'known'])).toBe('well-known');
  });
});

describe('sentenceChanges', () => {
  it('changes words one by one when the same number changed', () => {
    expect(changesFor('I has a apple.', 'I have an apple .')).toEqual([
      { start: 2, end: 5, before: 'has', after: 'have' },
      { start: 6, end: 7, before: 'a', after: 'an' },
    ]);
  });

  it('adds words and punctuation with the right spaces', () => {
    expect(fixed('my parents tried that it worked', 'my parents tried to that it worked')).toBe(
      'my parents tried to that it worked',
    );
    expect(fixed('Nowadays people drive.', 'Nowadays , people drive .')).toBe(
      'Nowadays, people drive.',
    );
    expect(fixed('I like it', 'I like it .')).toBe('I like it.');
    expect(fixed('is good.', 'It is good .')).toBe('It is good.');
    expect(changesFor('Nowadays people drive.', 'Nowadays , people drive .')).toEqual([
      { start: 8, end: 8, before: '', after: ',' },
    ]);
  });

  it('removes words with one space next to them', () => {
    expect(fixed('They use more the cars.', 'They use more cars .')).toBe('They use more cars.');
    expect(fixed('I like it too much.', 'I like it .')).toBe('I like it.');
    expect(fixed('The the cat sat.', 'The cat sat .')).toBe('The cat sat.');
    expect(fixed('Hello, world.', 'Hello world .')).toBe('Hello world.');
    // Just after "(" or an opening quote: the space after it goes.
    expect(fixed('I said (the yes) twice.', 'I said ( yes ) twice .')).toBe('I said (yes) twice.');
  });

  it('replaces a word with punctuation, and the other way round', () => {
    expect(fixed('It is convenient but it is dear.', 'It is convenient , it is dear .')).toBe(
      'It is convenient, it is dear.',
    );
    expect(fixed('Hello, world.', 'Hello and world .')).toBe('Hello and world.');
  });

  it('handles short forms, joined and split words', () => {
    expect(fixed("I don't know.", 'I do not know .')).toBe('I do not know.');
    expect(fixed('I dont know.', "I do n't know .")).toBe("I don't know.");
    expect(fixed('Every one came.', 'Everyone came .')).toBe('Everyone came.');
    expect(fixed('a well-known man', 'a well known man')).toBe('a well known man');
  });

  it('keeps curly apostrophes, line breaks and spacing as written', () => {
    expect(fixed('She don’t know.', "She does n't know .")).toBe('She doesn’t know.');
    expect(fixed('I  has\ta apple.', 'I have an apple .')).toBe('I  have\tan apple.');
  });

  it('adds short forms without a space before them, curly ones too', () => {
    // Made curly to match the sentence, they were then written with a space
    // before them: "it ’s raining", "Mary ’s house" (audit 3 F3-5).
    expect(fixed('It’s late and its raining.', "It 's late and it 's raining .")).toBe(
      'It’s late and it’s raining.',
    );
    expect(fixed('John’s car is at Marys house.', "John 's car is at Mary 's house .")).toBe(
      'John’s car is at Mary’s house.',
    );
    expect(fixed('It’s me, I is here.', "It 's me , I 'm here .")).toBe('It’s me, I’m here.');
    expect(fixed('I can’t come, I dont know.', "I ca n't come , I do n't know .")).toBe(
      'I can’t come, I don’t know.',
    );
    expect(changesFor('It’s late and its raining.', "It 's late and it 's raining .")).toEqual([
      { start: 14, end: 17, before: 'its', after: 'it’s' },
    ]);
    // The same with straight apostrophes.
    expect(fixed("It's late and its raining.", "It 's late and it 's raining .")).toBe(
      "It's late and it's raining.",
    );
    expect(written(['do', 'n’t', ',', 'he', '’s', 'here', ',', 'they', '’re', '’ll'])).toBe(
      'don’t, he’s here, they’re’ll',
    );
  });

  it('suggests nothing when only the model’s spelling of quotes differs', () => {
    expect(changesFor('He said “hi”.', 'He said " hi " .')).toEqual([]);
  });

  it('finds changes in the right place in a longer text', () => {
    const text = 'All good here. Then she go home.';
    const sentence = sentencesOf(text)[1];
    if (!sentence) throw new Error('no sentence');
    const [change] = sentenceChanges(text, sentence, ['Then', 'she', 'goes', 'home', '.']);
    expect(change && applyChange(text, change)).toBe('All good here. Then she goes home.');
  });
});

describe('accepting changes', () => {
  const text = 'I has a apple.';
  const changes = changesFor(text, 'I have an apple .');

  it('moves the other changes to where they are after one is made', () => {
    const [first, second] = changes;
    if (!first || !second) throw new Error('two changes expected');
    const after = applyChange(text, first);
    const rest = remainingAfter(changes, first);
    expect(rest).toHaveLength(1);
    expect(applyChange(after, rest[0] as Change)).toBe('I have an apple.');
    // And the other way round.
    expect(remainingAfter(changes, second)).toEqual([first]);
  });

  it('makes them all at once', () => {
    expect(applyAll(text, changes)).toBe('I have an apple.');
  });

  it('describes them', () => {
    expect(changes.map(changeLabel)).toEqual(['Change “has” to “have”', 'Change “a” to “an”']);
    expect(changeLabel({ before: '', after: ',' })).toBe('Add “,”');
    expect(changeLabel({ before: ' the', after: '' })).toBe('Remove “the”');
    expect(changeDone({ before: 'a', after: 'an' })).toBe('Changed “a” to “an”.');
    expect(changeDone({ before: '', after: ' to' })).toBe('Added “to”.');
    expect(changeDone({ before: ' the', after: '' })).toBe('Removed “the”.');
    expect([0, 1, 3].map(changesSummary)).toEqual([
      'No changes suggested.',
      '1 change suggested.',
      '3 changes suggested.',
    ]);
  });
});
