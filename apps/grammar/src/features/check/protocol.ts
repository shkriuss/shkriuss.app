/**
 * What the page and the checker's worker say to each other (docs/specs/apps/grammar.md §3): the
 * page sends a text, with a port for the answer, and the worker answers with the mistakes in it.
 * Messages cross from one to the other, so each side checks what it gets.
 */

/** The varieties of English that Harper knows. */
export const VARIETIES = ["american", "british", "australian", "canadian", "indian"] as const;

export type Variety = (typeof VARIETIES)[number];

/** A fix that Harper suggests: words in place of the mistake's, none, or words after them. */
export type Fix =
  | { readonly kind: "replace"; readonly text: string }
  | { readonly kind: "remove" }
  | { readonly kind: "insert"; readonly text: string };

/** A mistake in a text, as the worker reports it. */
export interface Mistake {
  /** Harper's kind of mistake, such as `Spelling` or `WordChoice`. */
  readonly kind: string;
  /** What is wrong, in Harper's words. */
  readonly message: string;
  /**
   * Where its words are in the text, as offsets in the text's string, from `start` to `end`,
   * which is not part of them.
   */
  readonly start: number;
  readonly end: number;
  /** Harper's fixes for it, each once. */
  readonly fixes: readonly Fix[];
}

/** What the page asks the worker: the mistakes in `text`, in `variety`. */
export interface CheckRequest {
  readonly text: string;
  readonly variety: Variety;
}

/** The worker's answer: the mistakes in the order of the text, or that the checker failed. */
export type CheckResponse =
  { readonly ok: true; readonly mistakes: readonly Mistake[] } | { readonly ok: false };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isVariety(value: unknown): value is Variety {
  return VARIETIES.some((variety) => variety === value);
}

export function isCheckRequest(value: unknown): value is CheckRequest {
  return isRecord(value) && typeof value["text"] === "string" && isVariety(value["variety"]);
}

function isFix(value: unknown): value is Fix {
  if (!isRecord(value)) {
    return false;
  }
  switch (value["kind"]) {
    case "replace":
    case "insert":
      return typeof value["text"] === "string";
    case "remove":
      return true;
    default:
      return false;
  }
}

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMistake(value: unknown): value is Mistake {
  return (
    isRecord(value) &&
    typeof value["kind"] === "string" &&
    typeof value["message"] === "string" &&
    isOffset(value["start"]) &&
    isOffset(value["end"]) &&
    value["start"] <= value["end"] &&
    Array.isArray(value["fixes"]) &&
    value["fixes"].every(isFix)
  );
}

export function isCheckResponse(value: unknown): value is CheckResponse {
  if (!isRecord(value)) {
    return false;
  }
  if (value["ok"] === false) {
    return true;
  }
  return (
    value["ok"] === true && Array.isArray(value["mistakes"]) && value["mistakes"].every(isMistake)
  );
}
