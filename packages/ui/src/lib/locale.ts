import { addDays, type IsoDate, type IsoTime } from '@shkriuss/dates';

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

// Words for dates and times that several apps show the same way, kept here
// rather than copied into each (audit 3 J-12). Tests give the locale, so they
// pass on a computer set to any language.

/** A time of day for people: "8:00 PM", or "20:00" where that's how times are written. */
export function timeLabel(time: IsoTime, locale = DATE_LOCALE): string {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(Date.UTC(2024, 0, 1, hour, minute));
}

/** "Today", "Yesterday", or a date like "Monday 19 October" ("Monday, October 19" in American English). */
export function dayLabel(date: IsoDate, today: IsoDate, locale = DATE_LOCALE): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(year, month - 1, day));
}

/** "2026-10" → "October 2026". */
export function monthLabel(month: string, locale = DATE_LOCALE): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, number - 1, 1));
}

/** "1st", "2nd", "3rd", "11th", "23rd": in English, like the words around it. */
export function ordinal(day: number): string {
  const suffix: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
  return `${day}${suffix[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(day)] ?? 'th'}`;
}
