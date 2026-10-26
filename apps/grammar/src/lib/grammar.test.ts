import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  knownFrom,
  merge,
  observe,
  valuesOf,
  type StoreSnapshot,
} from '../../../../packages/sync/src/merge.ts';
import {
  addWord,
  applyFix,
  contextOf,
  defaultEnglish,
  dictionaryFull,
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
  syncedSettings,
  withSyncedSettings,
  wordToAdd,
  type GrammarState,
  type Issue,
  type SyncedSetting,
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

  it('never starts or ends the text around a problem with half an emoji (audit 4 F3-7)', () => {
    for (let pad = 0; pad < 4; pad += 1) {
      const text = `${'x'.repeat(pad)}${'😀'.repeat(20)} I has ${'😀'.repeat(20)}`;
      const context = contextOf(text, issueIn(text, 'has'));
      expect(context.before + context.after).not.toMatch(/\p{Cs}/u);
      expect(context.problem).toBe('has');
    }
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
    let words = addWord([], 'Tbilisi') ?? [];
    words = addWord(words, 'Mtskheta') ?? [];
    words = addWord(words, 'Tbilisi') ?? [];
    expect(words).toEqual(['Mtskheta', 'Tbilisi']);
    expect(removeWord(words, 'Mtskheta')).toEqual(['Tbilisi']);
  });

  it('says when the dictionary is full, instead of adding nothing', () => {
    // With 500 words, "Add to my dictionary" added nothing, but said "Added" (audit F3-8).
    const full = Array.from({ length: MAX_WORDS }, (_, index) => `w${index}`);
    expect(addWord(full, 'Tbilisi')).toBeNull();
    // A word already in it is still in it.
    expect(addWord(full, 'w7')).toEqual(full);
    expect(addWord(full.slice(1), 'Tbilisi')).toHaveLength(MAX_WORDS);
    expect(dictionaryFull(MAX_WORDS)).toBe(
      'Your dictionary is full (500 words). Remove one to add another.',
    );
  });

  it('says how many to remove when sync brought more words than it keeps', () => {
    // Two devices' dictionaries merged can pass 500 words; then "Remove one"
    // wasn't enough to add another (audit 3 F3-9).
    const merged = Array.from({ length: 600 }, (_, index) => `w${index}`);
    expect(addWord(merged, 'Tbilisi')).toBeNull();
    expect(dictionaryFull(merged.length)).toBe(
      'Your dictionary has 600 words; it can keep 500. Remove 101 to add another.',
    );
    // Removing that many makes room for one.
    expect(addWord(merged.slice(101), 'Tbilisi')).toHaveLength(MAX_WORDS);
    expect(addWord(merged.slice(100), 'Tbilisi')).toBeNull();
    expect(dictionaryFull(501)).toBe(
      'Your dictionary has 501 words; it can keep 500. Remove 2 to add another.',
    );
    expect(dictionaryFull(2500)).toBe(
      'Your dictionary has 2,500 words; it can keep 500. Remove 2,001 to add another.',
    );
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

describe('sync', () => {
  const phone = { text: 'My secret diary entry.', english: 'british' as const, words: ['Tbilisi'] };

  it('sends the English choice and the dictionary, never the text', () => {
    const settings = syncedSettings(phone);
    expect(settings).toEqual([
      { id: 'english', english: 'british' },
      { id: 'word:Tbilisi', word: 'Tbilisi' },
    ]);
    expect(JSON.stringify(settings)).not.toContain('secret');
  });

  it('takes the settings that come back, keeping this device’s text', () => {
    const tablet = { text: 'A letter.', english: 'american' as const, words: ['Kutaisi'] };
    const merged: SyncedSetting[] = [
      { id: 'english', english: 'british' },
      { id: 'word:Tbilisi', word: 'Tbilisi' },
      { id: 'word:Mtskheta', word: 'Mtskheta' },
    ];
    expect(withSyncedSettings(tablet, merged)).toEqual({
      text: 'A letter.',
      english: 'british',
      // In alphabetical order, as the dictionary keeps them; Kutaisi was deleted elsewhere.
      words: ['Mtskheta', 'Tbilisi'],
    });
    expect(withSyncedSettings(tablet, syncedSettings(tablet))).toEqual(tablet);
  });

  it('ignores settings it can’t use', () => {
    const odd = [
      { id: 'english', english: 'canadian' },
      { id: 'word:x', word: 1 },
    ] as unknown as SyncedSetting[];
    expect(withSyncedSettings(phone, odd)).toEqual({ ...phone, words: [] });
  });
});

describe('the dictionary’s order on devices in different languages', () => {
  // Sorted in each device's own language, the order differed: Swedish puts
  // "Östersund" after "Zürich", English before it; Georgian puts Georgian
  // words first. Two devices with sync then re-sorted each other's order at
  // every round, which counts as a move, and kept uploading (audit 3 F3-6).
  const words = ['Zürich', 'ბათუმი', 'Östersund', 'Tbilisi'];
  const english = ['Östersund', 'Tbilisi', 'Zürich', 'ბათუმი'];
  const empty: GrammarState = { text: '', english: 'british', words: [] };
  const added = (list: readonly string[]) =>
    list.reduce<string[]>((dictionary, word) => addWord(dictionary, word) ?? dictionary, []);

  /** From now on, comparing text without saying the language compares as on a device set to `language`. */
  function deviceIn(language: string): void {
    const localeCompare = String.prototype.localeCompare;
    vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
      this: string,
      that: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return localeCompare.call(this, that, locales ?? language, options);
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sorts the same in every language', () => {
    expect([...words].sort((a, b) => a.localeCompare(b, 'sv'))).not.toEqual(english);
    for (const language of ['en', 'sv', 'ka']) {
      deviceIn(language);
      const settings = words.map((word): SyncedSetting => ({ id: `word:${word}`, word }));
      expect(withSyncedSettings(empty, settings).words, language).toEqual(english);
      expect(added(words), language).toEqual(english);
      vi.restoreAllMocks();
    }
    // Words that sort the same (é as one character, or as e and an accent) get one order too.
    const accents = ['Caf\u00e9', 'Cafe\u0301'];
    const settings = accents.map((word): SyncedSetting => ({ id: `word:${word}`, word }));
    for (const order of [settings, [...settings].reverse()]) {
      expect(withSyncedSettings(empty, order).words).toEqual(['Cafe\u0301', 'Caf\u00e9']);
    }
    expect(added([...accents].reverse())).toEqual(added(accents));
  });

  it('two devices in different languages stop uploading once they agree', () => {
    // The client's steps for each sync round (observe → merge → save →
    // knownFrom), with the real merge code; the devices take turns.
    const devices = ['en', 'sv'].map((language) => {
      deviceIn(language);
      const state = { ...empty, words: added(words) };
      vi.restoreAllMocks();
      return { language, state, known: undefined as ReturnType<typeof knownFrom> | undefined };
    });
    let online: StoreSnapshot | undefined;
    let now = Date.UTC(2026, 9, 25);
    const uploads: number[] = [];
    for (let round = 0; round < 30; round += 1) {
      const device = devices[round % 2];
      if (!device) continue;
      deviceIn(device.language);
      now += 60_000;
      const local = observe(device.known, syncedSettings(device.state), 1, now);
      const merged = online ? merge(local.snapshot, online) : local.snapshot;
      device.state = withSyncedSettings(device.state, valuesOf(merged) as SyncedSetting[]);
      if (local.changed || !online) {
        online = merged;
        uploads.push(round);
      }
      device.known = knownFrom(merged);
      vi.restoreAllMocks();
    }
    // Each uploads once, at its first round; before, uploads went on for ever.
    expect(uploads).toEqual([0, 1]);
    expect(devices.map((device) => device.state.words)).toEqual([english, english]);
  });
});
