/**
 * The locale for dates and times shown in sentences. The apps are in English,
 * so weekday and month names are too, even on a phone set to another language
 * (audit Z-9): otherwise a Georgian phone shows "Every ორშაბათი", and screen
 * readers read it with an English voice. That's the person's own kind of
 * English when their browser lists one, else British English with the 12- or
 * 24-hour clock of their first language. Numbers keep the browser's language.
 */
export function englishLocale(languages: readonly string[]): string {
  // Some systems add a "@posix"-like part, which isn't part of a language tag.
  const tags = languages.map((tag) => tag.split('@')[0] ?? '').filter(isLanguageTag);
  const english = tags.find((tag) => /^en(?:-|$)/i.test(tag));
  if (english) return english;
  try {
    const { hourCycle } = new Intl.DateTimeFormat(tags[0], {
      hour: 'numeric',
    }).resolvedOptions();
    return hourCycle ? new Intl.Locale('en-GB', { hourCycle }).toString() : 'en-GB';
  } catch {
    return 'en-GB';
  }
}

/** Whether dates can be written with `tag`. */
function isLanguageTag(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

/** This browser's locale for dates and times (see `englishLocale`). */
export const DATE_LOCALE = englishLocale(
  (globalThis as { navigator?: { languages?: readonly string[] } }).navigator?.languages ?? [],
);
