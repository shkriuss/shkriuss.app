import { createFormat, defineMessages } from "@shkriuss/i18n";

/** Harper's kinds of mistakes, as the list names them (docs/specs/apps/grammar.md §1). */
const KINDS: Readonly<Record<string, string>> = {
  Agreement: "Agreement",
  BoundaryError: "Word boundary",
  Capitalization: "Capitalization",
  Eggcorn: "Word choice",
  Enhancement: "Improvement",
  Formatting: "Formatting",
  Grammar: "Grammar",
  Malapropism: "Word choice",
  Miscellaneous: "Grammar",
  Nonstandard: "Nonstandard",
  Punctuation: "Punctuation",
  Readability: "Readability",
  Redundancy: "Redundancy",
  Regionalism: "Regional word",
  Repetition: "Repetition",
  Spelling: "Spelling",
  Style: "Style",
  Typo: "Typo",
  Usage: "Usage",
  WordChoice: "Word choice",
  WordOrder: "Word order",
};

/**
 * The app's text (ADR 0012): its name and what it does, for its frame, its manifest and its
 * page's title, and the text of its screens.
 */
export const messages = defineMessages((format) => ({
  appName: () => "Grammar",
  // The name under the icon on a home screen: at most 12 characters.
  appShortName: () => "Grammar",
  appDescription: () =>
    "Checks English text for mistakes in grammar, spelling and punctuation, and suggests fixes, on this device.",
  // The check screen.
  text: () => "Text",
  textHelp: (limit: number) =>
    `Up to ${format.number(limit)} characters. The text stays on this device, and only while the app is open.`,
  english: () => "English",
  american: () => "American",
  british: () => "British",
  australian: () => "Australian",
  canadian: () => "Canadian",
  indian: () => "Indian",
  copy: () => "Copy",
  copied: () => "The text is on the clipboard.",
  copyFailed: () => "The text could not be copied.",
  delete: () => "Delete",
  deleted: () => "The text is deleted.",
  undo: () => "Undo",
  undone: () => "The text is back.",
  gettingReady: () => "Getting the checker ready…",
  checking: () => "Checking…",
  cannotStart: () => "The checker cannot start in this browser, so the text cannot be checked.",
  checkFailed: () => "The text could not be checked. Reload the app to try again.",
  found: (count: number) =>
    count === 0
      ? "No mistakes found"
      : format.plural(count, { one: "# mistake found", other: "# mistakes found" }),
  mistakes: () => "Mistakes",
  // Harper's kind of mistake; a kind that a later Harper adds is one of the others.
  kind: (kind: string) => KINDS[kind] ?? "Other",
  replace: (words: string) => `Replace with “${words}”`,
  remove: () => "Remove",
  insert: (words: string) => `Add “${words}”`,
  show: () => "Show",
  ignore: () => "Ignore",
  // The list shows some of a long text's mistakes at a time.
  showMore: (count: number) => `Show ${format.number(count)} more`,
  // In the update banner, which offers to reload the app, while there is text.
  reloadWarning: () => "Updating clears the text, so copy it first if you need it.",
}));

export const m = messages(createFormat());
