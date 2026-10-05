/**
 * The locale of the UI's formats (architecture §10): the UI is in English, and dates, times and
 * numbers follow the device's regional settings. So the UI formats with English for the
 * device's region, such as `en-DE` for a device set to German or to Germany, which writes
 * "5 Oct 2026, 14:30" and "1.234,5". Browsers have English formats for many regions but not
 * all; for the others, the UI uses `en`, and keeps the device's choice of a 12-hour or 24-hour
 * clock.
 */

export type HourCycle = "h11" | "h12" | "h23" | "h24";

export interface UiLocale {
  /** An English locale: `en-<region>` for the device's region where the browser has it, or `en`. */
  readonly locale: string;
  /** The device's clock, which times use whatever the locale. */
  readonly hourCycle: HourCycle;
}

/**
 * The locale the device formats with: the browser's default, which follows the user's language
 * and region settings.
 */
export function deviceLocale(): string {
  return new Intl.DateTimeFormat().resolvedOptions().locale;
}

/** The locale of the UI's formats on a device that formats with `device`, such as `de-DE`. */
export function uiLocale(device: string): UiLocale {
  const hourCycle = new Intl.DateTimeFormat(device, { hour: "numeric" }).resolvedOptions()
    .hourCycle;
  const { region } = new Intl.Locale(device).maximize();
  const regional = region === undefined ? "en" : `en-${region}`;
  // Without English formats for the region, the browser resolves it to another locale.
  const supported = new Intl.DateTimeFormat(regional).resolvedOptions().locale === regional;
  return { locale: supported ? regional : "en", hourCycle: hourCycle ?? "h23" };
}
