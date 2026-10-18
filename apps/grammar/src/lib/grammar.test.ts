import { describe, expect, it } from 'vitest';
import {
  addWord,
  applyFix,
  contextOf,
  defaultEnglish,
  emptyState,
  fixDone,
  fixesToShow,
  fixLabel,
  isGrammarState,
  MAX_SHOWN,
  MAX_WORDS,
  plainMessage,
  removeWord,
  summary,
  wordToAdd,
  type Issue,
} from './grammar.ts';

/** An issue for `problem` where it first appears in `text`. */
function issueIn(text: string, problem: string, fields: Partial<Issue> = {}): Issue {
  const start = text.indexOf(problem);
  return {
    kind: 'Grammar',
    label: 'Grammar',
    start,
    end: start + problem.length,
    problem,
    message: '',
    fixes: [],
    ...fields,
  };
}

describe('fixes', () => {
  const text = 'I has a apple , ok';

  it('replaces, removes and adds text', () => {
    expect(applyFix(text, issueIn(text, 'has'), { kind: 'replace', text: 'have' })).toBe(
      'I have a apple , ok',
    );
    expect(applyFix(text, issueIn(text, ' ,'), { kind: 'remove', text: '' })).toBe(
      'I has a apple ok',
    );
    expect(applyFix(text, issueIn(text, 'apple'), { kind: 'insert-after', text: 's' })).toBe(
      'I has a apples , ok',
    );
  });

  it('counts positions like JavaScript does, emoji included', () => {
    // harper.js reports "are" at 6 here: the emoji takes two places.
    const withEmoji = '😀 He are happy.';
    expect(withEmoji.indexOf('are')).toBe(6);
    expect(applyFix(withEmoji, { start: 6, end: 9 }, { kind: 'replace', text: 'is' })).toBe(
      '😀 He is happy.',
    );
  });

  it('labels fixes so they can be told apart', () => {
    expect(fixLabel({ problem: 'a' }, { kind: 'replace', text: 'an' })).toBe('Change to “an”');
    expect(fixLabel({ problem: ' ' }, { kind: 'remove', text: '' })).toBe('Remove the space');
    expect(fixLabel({ problem: 'the the' }, { kind: 'remove', text: '' })).toBe('Remove “the the”');
    expect(fixLabel({ problem: 'Hello' }, { kind: 'insert-after', text: ',' })).toBe('Add “,”');
    expect(fixLabel({ problem: 'a  b' }, { kind: 'replace', text: ' ' })).toBe('Change to a space');
  });

  it('says what a fix did', () => {
    expect(fixDone({ problem: 'a' }, { kind: 'replace', text: 'an' })).toBe('Changed “a” to “an”.');
    expect(fixDone({ problem: ' ' }, { kind: 'remove', text: '' })).toBe('Removed the space.');
    expect(fixDone({ problem: 'Hi' }, { kind: 'insert-after', text: ',' })).toBe('Added “,”.');
  });

  it('shows up to three fixes, without ones that look the same', () => {
    const issue = issueIn('Their going', 'Their', {
      fixes: [
        { kind: 'replace', text: "They're" },
        { kind: 'replace', text: "They're " },
        { kind: 'replace', text: 'There' },
        { kind: 'replace', text: 'The' },
        { kind: 'replace', text: 'Thee' },
      ],
    });
    expect(fixesToShow(issue).map((fix) => fix.text)).toEqual(["They're", 'There', 'The']);
  });
});

describe('what the page shows', () => {
  it('puts words in quotes instead of backticks', () => {
    expect(plainMessage('Did you mean `they’re`? Not `there`.')).toBe(
      'Did you mean “they’re”? Not “there”.',
    );
  });

  it('shows a problem with a little text either side, on one line', () => {
    const text = `${'x'.repeat(50)} I has\n\na apple ${'y'.repeat(50)}`;
    const context = contextOf(text, issueIn(text, 'has'));
    expect(context.problem).toBe('has');
    expect(context.before).toMatch(/^…x+ I $/);
    expect(context.after).toMatch(/^ a apple y+…$/);
    expect(contextOf('I has', issueIn('I has', 'has'))).toEqual({
      before: 'I ',
      problem: 'has',
      after: '',
    });
  });

  it('counts suggestions in words', () => {
    expect(summary(0)).toBe('No problems found.');
    expect(summary(1)).toBe('1 suggestion.');
    expect(summary(3)).toBe('3 suggestions.');
    expect(summary(MAX_SHOWN + 5)).toBe(`${MAX_SHOWN + 5} suggestions. Showing the first 100.`);
  });
});

describe('dictionary', () => {
  it('offers to add misspelled words, not other problems', () => {
    expect(wordToAdd({ kind: 'Spelling', problem: 'Shkriuss' })).toBe('Shkriuss');
    expect(wordToAdd({ kind: 'Spelling', problem: 'O’Brien' })).toBe('O’Brien');
    expect(wordToAdd({ kind: 'Grammar', problem: 'has' })).toBeUndefined();
    expect(wordToAdd({ kind: 'Spelling', problem: 'two words' })).toBeUndefined();
    expect(wordToAdd({ kind: 'Spelling', problem: 'x'.repeat(61) })).toBeUndefined();
  });

  it('adds each word once, in order, and removes it again', () => {
    let words = addWord([], 'Tbilisi');
    words = addWord(words, 'Daviti');
    words = addWord(words, 'Tbilisi');
    expect(words).toEqual(['Daviti', 'Tbilisi']);
    expect(removeWord(words, 'Daviti')).toEqual(['Tbilisi']);
    const full = Array.from({ length: MAX_WORDS }, (_, index) => `w${index}`);
    expect(addWord(full, 'more')).toHaveLength(MAX_WORDS);
  });
});

describe('settings', () => {
  it('starts with the English of the browser’s language', () => {
    expect(defaultEnglish('en-US')).toBe('american');
    expect(defaultEnglish('en-GB')).toBe('british');
    expect(defaultEnglish('en-AU')).toBe('british');
    expect(defaultEnglish('en')).toBe('american');
    expect(defaultEnglish('ka-GE')).toBe('american');
  });

  it('accepts only what Grammar saves', () => {
    expect(isGrammarState(emptyState())).toBe(true);
    expect(isGrammarState({ text: 'Hi', english: 'british', words: ['Tbilisi'] })).toBe(true);
    for (const value of [
      null,
      {},
      { text: 1, english: 'british', words: [] },
      { text: '', english: 'canadian', words: [] },
      { text: '', english: 'british', words: [1] },
    ]) {
      expect(isGrammarState(value), JSON.stringify(value)).toBe(false);
    }
  });
});
