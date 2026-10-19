/**
 * Deep check, step 3: what the model's answers mean. GECToR ("Tag, Not
 * Rewrite", from Grammarly's researchers) doesn't write new text: for each
 * word it picks one of 5,002 labels, such as $KEEP, $DELETE,
 * $REPLACE_have, $APPEND_the (add "the" after the word) or
 * $TRANSFORM_VERB_VB_VBZ ("go" → "goes"). The labels are applied, and the
 * sentence is read again, until nothing changes (up to MAX_PASSES times).
 *
 * This is a careful copy of the code that scored best in our tests
 * (docs/adr/0012), so the app behaves the way it was measured.
 */
import { MAX_PASSES, MIN_PROBABILITY } from './deep-check.ts';

/** labels.txt: one label per line, in the model's order. */
export const parseLabels = (text: string): string[] =>
  text.split('\n').filter((line, index, lines) => line !== '' || index < lines.length - 1);

/**
 * verb-form-vocab.txt ("go_goes:VB_VBZ" per line) as a table from
 * "go_VB_VBZ" to "goes". The first line for a form wins.
 */
export function parseVerbForms(text: string): Map<string, string> {
  const forms = new Map<string, string>();
  for (const line of text.split('\n')) {
    const [words, tags] = line.trim().split(':');
    const [from, to] = words?.split('_') ?? [];
    const [fromTag, toTag] = tags?.split('_') ?? [];
    if (!from || !to || !fromTag || !toTag) continue;
    const key = `${from}_${fromTag}_${toTag}`;
    if (!forms.has(key)) forms.set(key, to);
  }
  return forms;
}

export interface Prediction {
  /** The most likely label's number. */
  label: number;
  /** How sure the model is of it (0 to 1). */
  probability: number;
}

/**
 * The most likely label, and its probability, at each of `positions`, from
 * the model's raw scores ("logits": `labelCount` numbers per piece).
 */
export function predictions(
  logits: Float32Array,
  labelCount: number,
  positions: readonly number[],
): Prediction[] {
  return positions.map((position) => {
    const offset = position * labelCount;
    let best = 0;
    let max = -Infinity;
    for (let label = 0; label < labelCount; label += 1) {
      const score = logits[offset + label] ?? -Infinity;
      if (score > max) {
        max = score;
        best = label;
      }
    }
    let sum = 0;
    for (let label = 0; label < labelCount; label += 1) {
      sum += Math.exp((logits[offset + label] ?? -Infinity) - max);
    }
    return { label: best, probability: 1 / sum };
  });
}

export interface Edit {
  /** The word's position (-1 for "$START", before the first word). */
  index: number;
  label: string;
}

/**
 * The edits to make: labels other than $KEEP the model is at least
 * `minProbability` sure of. Before the first word, only additions make sense.
 * `found[0]` is for "$START", then one per word.
 */
export function chooseEdits(
  found: readonly Prediction[],
  labels: readonly string[],
  minProbability = MIN_PROBABILITY,
): Edit[] {
  const edits: Edit[] = [];
  found.forEach(({ label: number, probability }, position) => {
    const label = labels[number] ?? '$KEEP';
    if (label === '$KEEP' || label.startsWith('@@') || probability < minProbability) return;
    if (position === 0 && !label.startsWith('$APPEND_')) return;
    edits.push({ index: position - 1, label });
  });
  return edits;
}

/** A word changed by a $TRANSFORM_… label, or undefined if it can't be. */
export function transform(
  word: string,
  label: string,
  verbs: ReadonlyMap<string, string>,
): string | undefined {
  if (label.startsWith('$TRANSFORM_CASE_')) {
    const kind = label.slice('$TRANSFORM_CASE_'.length);
    if (kind === 'LOWER') return word.toLowerCase();
    if (kind === 'UPPER') return word.toUpperCase();
    if (kind === 'CAPITAL') return word.slice(0, 1).toUpperCase() + word.slice(1);
    if (kind === 'CAPITAL_1')
      return word.slice(0, 1) + word.slice(1, 2).toUpperCase() + word.slice(2);
    if (kind === 'UPPER_-1') return word.slice(0, -1).toUpperCase() + word.slice(-1);
    return word;
  }
  if (label.startsWith('$TRANSFORM_VERB_')) {
    const [fromTag, toTag] = label.split('_').slice(-2);
    return verbs.get(`${word}_${fromTag}_${toTag}`);
  }
  if (label === '$TRANSFORM_AGREEMENT_SINGULAR')
    return word.endsWith('s') ? word.slice(0, -1) : word;
  if (label === '$TRANSFORM_AGREEMENT_PLURAL') return `${word}s`;
  if (label === '$TRANSFORM_SPLIT_HYPHEN') return word.split('-').join(' ');
  return word;
}

const MERGES: Record<string, string> = { $MERGE_SPACE: '', $MERGE_HYPHEN: '-' };

/** The words with the edits made (edits in word order, as chooseEdits gives them). */
export function applyEdits(
  words: readonly string[],
  edits: readonly Edit[],
  verbs: ReadonlyMap<string, string>,
): string[] {
  const out = [...words];
  let shift = 0;
  for (const { index, label } of edits) {
    const at = index + shift;
    if (label === '$DELETE') {
      out.splice(at, 1);
      shift -= 1;
    } else if (label.startsWith('$APPEND_')) {
      out.splice(at + 1, 0, label.slice('$APPEND_'.length));
      shift += 1;
    } else if (label.startsWith('$REPLACE_')) {
      out[at] = label.slice('$REPLACE_'.length);
    } else if (label.startsWith('$TRANSFORM_')) {
      const changed = transform(out[at] ?? '', label, verbs);
      if (changed) out[at] = changed;
    } else if (label in MERGES) {
      out.splice(at + 1, 0, label);
      shift += 1;
    }
  }
  // "every" $MERGE_SPACE "one" → "everyone".
  const merged: string[] = [];
  for (const word of out) {
    const last = merged.at(-1);
    if (last !== undefined && last in MERGES && merged.length >= 2) {
      merged.pop();
      merged[merged.length - 1] += `${MERGES[last] ?? ''}${word}`;
    } else {
      merged.push(word);
    }
  }
  // A split ("well known") becomes two words.
  return merged.filter((word) => !(word in MERGES)).flatMap((word) => word.split(' '));
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((word, index) => word === b[index]);

/**
 * Corrects one sentence: asks the model (`predict`, which gives one
 * prediction for "$START" and then one per word), makes its edits, and asks
 * again until nothing changes.
 */
export async function correct(
  words: readonly string[],
  predict: (words: readonly string[]) => Promise<Prediction[]>,
  labels: readonly string[],
  verbs: ReadonlyMap<string, string>,
): Promise<string[]> {
  let current = [...words];
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const edits = chooseEdits(await predict(current), labels);
    if (edits.length === 0) break;
    const next = applyEdits(current, edits, verbs);
    if (same(next, current)) break;
    current = next;
  }
  return current;
}
