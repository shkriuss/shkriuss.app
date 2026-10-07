import { createFormat, defineMessages } from "@shkriuss/i18n";

/**
 * The app's text (ADR 0012): its name and what it does, for its frame, its manifest and its
 * page's title, and the text of its screens.
 */
export const messages = defineMessages((format) => ({
  appName: () => "Template without data",
  // The name under the icon on a home screen: at most 12 characters.
  appShortName: () => "Template",
  appDescription: () =>
    "Counts the words of a text, and keeps nothing: the app that every new app without data starts from.",
  text: () => "Text",
  words: (count: number) => format.plural(count, { one: "# word", other: "# words" }),
}));

export const m = messages(createFormat());
