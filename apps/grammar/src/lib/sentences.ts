/**
 * Deep check, step 1: splits text into sentences and words the way the model
 * was trained to read them (like the spaCy library does): "don't" is "do" +
 * "n't", "apple." is "apple" + ".", "well-known" is "well" + "-" + "known".
 * Each word remembers where it is in the text (UTF-16 positions, like
 * JavaScript strings), so changes can be made in the right place.
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
const CLITIC = /^(.*\p{L})(n['’]t|['’](?:s|re|ve|ll|d|m))$/iu;
const ELLIPSIS = /^(.*?)(\.{2,}|…)$/u;
/** Abbreviations keep their full stop ("Mr.", "e.g.", "U.S.", initials like "J."). */
const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'st.', 'jr.', 'sr.', 'vs.', 'etc.', 'approx.',
  'dept.', 'inc.', 'ltd.', 'co.', 'corp.', 'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.',
  'aug.', 'sep.', 'sept.', 'oct.', 'nov.', 'dec.', 'mt.', 'ft.', 'no.', 'vol.', 'fig.',
]); // prettier-ignore
const LINK = /^(?:https?:\/\/|www\.)\S+$|^[^\s@]+@[^\s@]+\.\p{L}{2,}$/iu;
/** Hyphens and dashes between words, slashes and commas between letters. */
const INFIX =
  /(?<=[\p{L}\p{N}])(?:-|–|—)(?=\p{L})|(?<=\p{L})[/,](?=\p{L})|(?<=\p{L})(?:\.{2,}|…)(?=\p{L})/gu;

const isAbbreviation = (token: string): boolean =>
  ABBREVIATIONS.has(token.toLowerCase()) ||
  /^(?:\p{L}\.){2,}$/u.test(token) ||
  /^\p{Lu}\.$/u.test(token);

const toModel = (text: string): string => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

/** Splits one run of non-space characters into words, as [start, end] offsets within it. */
export function splitPiece(piece: string): [number, number][] {
  let from = 0;
  let to = piece.length;
  const head: [number, number][] = [];
  const tail: [number, number][] = [];
  const core = () => piece.slice(from, to);

  if (LINK.test(piece)) {
    while (to > from + 1 && /[.,!?;:)\]]/.test(piece[to - 1] ?? '')) {
      tail.unshift([to - 1, to]);
      to -= 1;
    }
    return [...head, [from, to], ...tail];
  }

  while (to - from > 1 && PREFIXES.has(piece[from] ?? '')) {
    head.push([from, from + 1]);
    from += 1;
  }
  for (;;) {
    const token = core();
    if (token.length <= 1) break;
    const ellipsis = ELLIPSIS.exec(token);
    const clitic = CLITIC.exec(token);
    const last = token.at(-1) ?? '';
    if (ellipsis?.[1]) {
      tail.unshift([from + ellipsis[1].length, to]);
      to = from + ellipsis[1].length;
    } else if (SUFFIXES.has(last) && !(last === '.' && isAbbreviation(token))) {
      tail.unshift([to - 1, to]);
      to -= 1;
    } else if (clitic?.[1] && clitic[2]) {
      tail.unshift([from + clitic[1].length, to]);
      to = from + clitic[1].length;
    } else if (/^cannot$/i.test(token)) {
      tail.unshift([from + 3, to]);
      to = from + 3;
    } else {
      break;
    }
  }

  const middle: [number, number][] = [];
  let start = from;
  for (const match of core().matchAll(INFIX)) {
    const at = from + match.index;
    if (at > start) middle.push([start, at]);
    middle.push([at, at + match[0].length]);
    start = at + match[0].length;
  }
  if (to > start) middle.push([start, to]);
  return [...head, ...middle, ...tail];
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
  words.forEach((word, index) => {
    const previous = words[index - 1];
    if (previous && current.length > 0 && text.slice(previous.end, word.start).includes('\n')) {
      groups.push(current);
      current = [];
    }
    current.push(word);
    const next = words[index + 1];
    const ended = current.findLastIndex((entry) => ENDS_SENTENCE.test(entry.model));
    const onlyClosingSince = current.slice(ended + 1).every((entry) => CLOSING.has(entry.model));
    if (
      ended >= 0 &&
      onlyClosingSince &&
      !(next && CLOSING.has(next.model) && next.start === word.end) &&
      !(next && /^\p{Ll}/u.test(next.text))
    ) {
      groups.push(current);
      current = [];
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
