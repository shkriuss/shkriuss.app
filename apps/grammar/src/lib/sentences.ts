/**
 * Deep check, step 1: splits text into sentences and words the way the model
 * was trained to read them (like the spaCy library does): "don't" is "do" +
 * "n't", "dont" is "do" + "nt", "apple." is "apple" + ".", "well-known" is
 * "well" + "-" + "known". Each word remembers where it is in the text (UTF-16
 * positions, like JavaScript strings), so changes can be made in the right
 * place.
 */

export interface Word {
  /** As written in the text. */
  text: string;
  /** As the model reads it: straight apostrophes and quotes. */
  model: string;
  start: number;
  end: number;
}

export interface Sentence {
  start: number;
  end: number;
  words: Word[];
}

/** Longer sentences are checked in pieces (the model reads up to about 400 words). */
export const MAX_SENTENCE_WORDS = 80;

/** Written without a space before: punctuation, closing quotes, "n't", "'s". */
const PREFIXES = new Set([...'([{"\'“‘«¿¡$£€#*']);
const SUFFIXES = new Set([...')]}"\'”’»,.!?;:%*']);
/** "n't", "'s" and the like at the end of a word (after a letter: see cliticLength). */
const CLITIC = /(?:n['’]t|['’](?:s|re|ve|ll|d|m))$/iu;
/**
 * Words without an apostrophe that spaCy splits (its English tokenizer
 * exceptions), since the model learned from text split that way: short forms
 * typed without an apostrophe ("dont" is "do" + "nt", "Ive" is "I" + "ve",
 * "youre" is "you" + "re") and times ("5pm" is "5" + "pm"). Kept whole, the
 * model didn't know them: it changed "dont" to "do", and "at 5pm" to "at 5
 * 5pm" (audit 3 F3-2). Each row: words, then the endings each of them takes
 * ("+" between the parts of a longer one, as in "couldntve").
 */
const SPLITS: readonly (readonly [words: string, endings: string])[] = [
  ['ca could do does did had may might must need ought sha should wo would', 'nt nt+ve'],
  ['ai are is was were have has dare', 'nt'],
  ['could might must should would', 've'],
  ['i', 'm m+a'],
  ['i you he she it we they', 'll ll+ve d d+ve'],
  ['i you we they', 've'],
  ['you we they', 're'],
  ['he she it', 's'],
  ['who what when where why how there that this these those', 'll ll+ve d d+ve'],
  ['who what when where why how there that this', 's'],
  ['who what when where why how there these those', 're ve'],
  ['not', 've'],
  ['gon', 'na'],
  ['got', 'ta'],
  ['1 2 3 4 5 6 7 8 9 10 11 12', 'am pm a.m. p.m.'],
];
/** Real words that look like short forms: spaCy keeps them whole. */
const NOT_SPLIT = new Set(['ill', 'its', 'hell', 'shell', 'shed', 'were', 'well', 'whore']);
/**
 * Each of them, as spaCy knows it (in small letters, or with a capital first
 * letter: "dont", "Dont", not "DONT"), and the lengths of the endings split
 * off it, the last first ("couldntve": 2, 2).
 */
const SPLIT_ENDINGS = new Map<string, number[]>();
for (const [words, endings] of SPLITS) {
  for (const word of words.split(' ')) {
    for (const ending of endings.split(' ')) {
      const parts = ending.split('+');
      const whole = word + parts.join('');
      if (NOT_SPLIT.has(whole)) continue;
      const lengths = parts.map((part) => part.length).reverse();
      SPLIT_ENDINGS.set(whole, lengths);
      SPLIT_ENDINGS.set(whole.charAt(0).toUpperCase() + whole.slice(1), lengths);
    }
  }
}
// "yall" ("y" + "all") too, only in small letters.
SPLIT_ENDINGS.set('yall', [3]);
const LONGEST_SPLIT = Math.max(...[...SPLIT_ENDINGS.keys()].map((whole) => whole.length));
/** Abbreviations keep their full stop ("Mr.", "e.g.", "U.S.", initials like "J."). */
const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'st.', 'jr.', 'sr.', 'vs.', 'etc.', 'approx.',
  'dept.', 'inc.', 'ltd.', 'co.', 'corp.', 'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.',
  'aug.', 'sep.', 'sept.', 'oct.', 'nov.', 'dec.', 'mt.', 'ft.', 'no.', 'vol.', 'fig.',
]); // prettier-ignore
const LONGEST_ABBREVIATION = Math.max(...[...ABBREVIATIONS].map((entry) => entry.length));
const LINK = /^(?:https?:\/\/|www\.)\S+$|^[^\s@]+@[^\s@]+\.\p{L}{2,}$/iu;
/** Hyphens and dashes between words, slashes and commas between letters. */
const INFIX =
  /(?<=[\p{L}\p{N}])(?:-|–|—)(?=\p{L})|(?<=\p{L})[/,](?=\p{L})|(?<=\p{L})(?:\.{2,}|…)(?=\p{L})/gu;

const toModel = (text: string): string => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

const isLetter = (character: string): boolean => /^\p{L}$/u.test(character);

/** How many full stops come right before each position of `text` (`[i]`: those ending at i). */
function stopsBefore(text: string): number[] {
  const counts = [0];
  for (let index = 0; index < text.length; index += 1) {
    counts.push(text[index] === '.' ? (counts[index] ?? 0) + 1 : 0);
  }
  return counts;
}

/**
 * Where letters each followed by a full stop ("U.S.", "e.g.") end, from
 * `from` on: each end after two or more of them.
 */
function initialsEnds(text: string, from: number): Set<number> {
  const ends = new Set<number>();
  let at = from;
  for (let pairs = 1; ; pairs += 1) {
    const letter = String.fromCodePoint(text.codePointAt(at) ?? 32);
    if (!isLetter(letter) || text[at + letter.length] !== '.') return ends;
    at += letter.length + 1;
    if (pairs >= 2) ends.add(at);
  }
}

/** The length of the "n't", "'s"… that `text` has at `end`, after a letter (0: none). */
function cliticLength(text: string, from: number, end: number): number {
  const clitic = CLITIC.exec(text.slice(Math.max(from, end - 3), end))?.[0] ?? '';
  const before = [...text.slice(Math.max(from, end - clitic.length - 2), end - clitic.length)];
  return clitic && isLetter(before.at(-1) ?? '') ? clitic.length : 0;
}

/**
 * Splits one run of non-space characters into words, as [start, end]
 * offsets within it. Punctuation at the end is split off one by one, in one
 * pass over it: looking at the whole rest again for each mark took seconds
 * for a word with thousands of ")" after it (audit F3-11).
 */
export function splitPiece(piece: string): [number, number][] {
  let from = 0;
  let to = piece.length;
  const head: [number, number][] = [];
  /** The words split off the end, last first. */
  const tail: [number, number][] = [];

  if (LINK.test(piece)) {
    while (to > from + 1 && /[.,!?;:)\]]/.test(piece[to - 1] ?? '')) {
      tail.push([to - 1, to]);
      to -= 1;
    }
    return [...head, [from, to], ...tail.reverse()];
  }

  while (to - from > 1 && PREFIXES.has(piece[from] ?? '')) {
    head.push([from, from + 1]);
    from += 1;
  }
  const stops = stopsBefore(piece);
  const initials = initialsEnds(piece, from);
  /** Whether what's left is an abbreviation, which keeps its full stop. */
  const isAbbreviation = (): boolean => {
    const token = to - from <= LONGEST_ABBREVIATION ? piece.slice(from, to) : '';
    return ABBREVIATIONS.has(token.toLowerCase()) || /^\p{Lu}\.$/u.test(token) || initials.has(to);
  };
  for (;;) {
    const length = to - from;
    if (length <= 1) break;
    // "dont" is "do" + "nt", "5p.m." is "5" + "p.m.": checked first, as spaCy
    // does, and that's the end of it (audit 3 F3-2).
    const endings = length <= LONGEST_SPLIT ? SPLIT_ENDINGS.get(piece.slice(from, to)) : undefined;
    if (endings) {
      for (const ending of endings) {
        tail.push([to - ending, to]);
        to -= ending;
      }
      break;
    }
    const last = piece[to - 1] ?? '';
    // "..." (as long as it is) or "…", after something else.
    const dots = Math.min(stops[to] ?? 0, length);
    const ellipsis = dots >= 2 ? dots : last === '…' ? 1 : 0;
    if (ellipsis > 0 && ellipsis < length) {
      tail.push([to - ellipsis, to]);
      to -= ellipsis;
      continue;
    }
    if (SUFFIXES.has(last) && !(last === '.' && isAbbreviation())) {
      tail.push([to - 1, to]);
      to -= 1;
      continue;
    }
    const clitic = cliticLength(piece, from, to);
    if (clitic > 0) {
      tail.push([to - clitic, to]);
      to -= clitic;
    } else if (length === 6 && /^cannot$/i.test(piece.slice(from, to))) {
      tail.push([from + 3, to]);
      to = from + 3;
    } else {
      break;
    }
  }

  const middle: [number, number][] = [];
  let start = from;
  for (const match of piece.slice(from, to).matchAll(INFIX)) {
    const at = from + match.index;
    if (at > start) middle.push([start, at]);
    middle.push([at, at + match[0].length]);
    start = at + match[0].length;
  }
  if (to > start) middle.push([start, to]);
  return [...head, ...middle, ...tail.reverse()];
}

/** Every word in the text, in order. */
export function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  for (const match of text.matchAll(/\S+/gu)) {
    for (const [start, end] of splitPiece(match[0])) {
      const wordText = match[0].slice(start, end);
      words.push({
        text: wordText,
        model: toModel(wordText),
        start: match.index + start,
        end: match.index + end,
      });
    }
  }
  return words;
}

const ENDS_SENTENCE = /^(?:[.!?]+|\.{2,}|…)$/u;
const CLOSING = new Set([')', ']', '}', '"', "'", '»']);

/** Splits a long list of words at a comma or semicolon near the end, or at the limit. */
function pieces(words: Word[]): Word[][] {
  const result: Word[][] = [];
  let rest = words;
  while (rest.length > MAX_SENTENCE_WORDS) {
    let cut = MAX_SENTENCE_WORDS;
    for (let index = MAX_SENTENCE_WORDS - 1; index >= MAX_SENTENCE_WORDS / 4; index -= 1) {
      if ([',', ';', ':'].includes(rest[index]?.model ?? '')) {
        cut = index + 1;
        break;
      }
    }
    result.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return [...result, rest];
}

/**
 * The text's sentences: they end after ".", "!" or "?" (and any closing
 * quote) when the next word doesn't start with a small letter, and at every
 * line break. Sentences without any letters are left out.
 */
export function sentencesOf(text: string): Sentence[] {
  const words = wordsOf(text);
  const groups: Word[][] = [];
  let current: Word[] = [];
  // Kept as words are added (looking back over the sentence at each word
  // took long for long ones): whether one ended the sentence, and whether
  // only closing quotes and brackets came after it.
  let ended = false;
  let onlyClosingSince = true;
  const nextGroup = (): void => {
    groups.push(current);
    current = [];
    ended = false;
    onlyClosingSince = true;
  };
  words.forEach((word, index) => {
    const previous = words[index - 1];
    if (previous && current.length > 0 && text.slice(previous.end, word.start).includes('\n')) {
      nextGroup();
    }
    current.push(word);
    if (ENDS_SENTENCE.test(word.model)) {
      ended = true;
      onlyClosingSince = true;
    } else {
      onlyClosingSince &&= CLOSING.has(word.model);
    }
    const next = words[index + 1];
    if (
      ended &&
      onlyClosingSince &&
      !(next && CLOSING.has(next.model) && next.start === word.end) &&
      !(next && /^\p{Ll}/u.test(next.text))
    ) {
      nextGroup();
    }
  });
  if (current.length > 0) groups.push(current);

  return groups
    .filter((group) => group.some((word) => /\p{L}/u.test(word.text)))
    .flatMap(pieces)
    .map((group) => ({
      start: group[0]?.start ?? 0,
      end: group.at(-1)?.end ?? 0,
      words: group,
    }));
}
