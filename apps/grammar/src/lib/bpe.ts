/**
 * Deep check, step 2: turns words into the numbers the model reads ("word
 * pieces"), exactly like the Hugging Face tokenizer it was trained with
 * (RoBERTa's byte-level BPE): the word's UTF-8 bytes are written as
 * characters, then joined into the longest known pieces, following the
 * model's list of merges in order.
 */

/** Ids of the model's special pieces. */
export const START_ID = 0;
export const END_ID = 2;
export const UNKNOWN_ID = 3;
/** The most pieces the model reads at once (512, less the start and end). */
export const MAX_PIECES = 510;

/** GPT-2's byte ↔ character table: printable bytes as themselves, others moved past 255. */
function byteCharacters(): string[] {
  const printable = (byte: number) =>
    (byte >= 33 && byte <= 126) || (byte >= 161 && byte <= 172) || (byte >= 174 && byte <= 255);
  const table: string[] = [];
  let extra = 0;
  for (let byte = 0; byte < 256; byte += 1) {
    table[byte] = String.fromCodePoint(printable(byte) ? byte : 256 + extra++);
  }
  return table;
}

/** How the tokenizer splits text before joining pieces (the GPT-2 pattern). */
const SPLIT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

export class Bpe {
  readonly #vocab: Map<string, number>;
  readonly #ranks: Map<string, number>;
  readonly #bytes = byteCharacters();
  readonly #encoder = new TextEncoder();
  readonly #cache = new Map<string, number[]>();

  /** `vocab`: vocab.json; `merges`: merges.txt (one "a b" pair per line, in order). */
  constructor(vocab: Record<string, number>, merges: string) {
    this.#vocab = new Map(Object.entries(vocab));
    this.#ranks = new Map(
      merges
        .split('\n')
        .filter((line) => line !== '' && !line.startsWith('#version'))
        .map((line, rank) => [line, rank]),
    );
  }

  /** The pieces of one split, e.g. "Ġapple" → ["Ġapple"], "Ġapples" → ["Ġapp", "les"]. */
  #pieces(chunk: string): string[] {
    let symbols = [...this.#encoder.encode(chunk)].map((byte) => this.#bytes[byte] ?? '');
    for (;;) {
      let best = -1;
      let bestRank = Infinity;
      for (let index = 0; index < symbols.length - 1; index += 1) {
        const rank = this.#ranks.get(`${symbols[index]} ${symbols[index + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          best = index;
        }
      }
      if (best < 0) return symbols;
      // Join every non-overlapping occurrence of the best pair, left to right.
      const left = symbols[best];
      const right = symbols[best + 1];
      const joined: string[] = [];
      for (let index = 0; index < symbols.length; index += 1) {
        if (index < symbols.length - 1 && symbols[index] === left && symbols[index + 1] === right) {
          joined.push(`${left}${right}`);
          index += 1;
        } else {
          joined.push(symbols[index] ?? '');
        }
      }
      symbols = joined;
    }
  }

  /** The ids for some text (no start or end marks). */
  encode(text: string): number[] {
    const cached = this.#cache.get(text);
    if (cached) return cached;
    const ids = [...text.matchAll(SPLIT)].flatMap((match) =>
      this.#pieces(match[0]).map((piece) => this.#vocab.get(piece) ?? UNKNOWN_ID),
    );
    if (this.#cache.size < 50_000) this.#cache.set(text, ids);
    return ids;
  }

  /**
   * The model's input for a sentence, as GECToR reads it: start mark,
   * "$START", each word with a space before it, end mark. `starts` is where
   * each word's first piece is ("$START" first). Words that don't fit in
   * MAX_PIECES are left out; `count` says how many fit.
   */
  encodeWords(words: readonly string[]): { ids: number[]; starts: number[]; count: number } {
    const ids = [START_ID];
    const starts: number[] = [];
    let count = 0;
    for (const [index, word] of ['$START', ...words].entries()) {
      const pieces = this.encode(index === 0 ? word : ` ${word}`);
      const add = pieces.length > 0 ? pieces : [UNKNOWN_ID];
      if (ids.length - 1 + add.length > MAX_PIECES) break;
      starts.push(ids.length);
      ids.push(...add);
      if (index > 0) count += 1;
    }
    ids.push(END_ID);
    return { ids, starts, count };
  }
}
