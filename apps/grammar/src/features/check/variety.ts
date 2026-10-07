import type { Variety } from "./protocol.ts";

/** The variety of English of each region that has one of Harper's own. */
const REGIONS: Readonly<Record<string, Variety>> = {
  GB: "british",
  // Ireland and New Zealand spell as Britain does.
  IE: "british",
  NZ: "british",
  AU: "australian",
  CA: "canadian",
  IN: "indian",
};

/**
 * The variety of English that the checker starts with, from the browser's language, such as
 * `en-GB`: British English for `en-GB`, and so on, or else American English.
 */
export function varietyOf(locale: string): Variety {
  let parsed: Intl.Locale;
  try {
    parsed = new Intl.Locale(locale);
  } catch {
    return "american";
  }
  const variety =
    parsed.language === "en" && parsed.region !== undefined ? REGIONS[parsed.region] : undefined;
  return variety ?? "american";
}
