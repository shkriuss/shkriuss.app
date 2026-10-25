/**
 * Text boxes that take only so much (maxlength), like Grammar's 20,000
 * characters (audit F3-3): whether typing or a paste didn't all fit, and
 * what to say then. A browser keeps only the start of a paste that's too
 * long, and ignores typing past the limit, without a word; the page part
 * (scripts/text-limit.ts) says so. Kept apart from the page so it can be
 * tested on its own.
 */

/** How long text is in a box: a line break counts once, however it was written ("\r\n" too). */
export const boxLength = (text: string): number => text.replace(/\r\n?/g, '\n').length;

/**
 * Whether typing or a paste was cut short by a box that takes up to `max`
 * characters: `wanted` is how long the text would be with all of it, `now`
 * how long it is.
 */
export const wasCut = (wanted: number, now: number, max: number): boolean =>
  wanted > max && now < wanted;

/**
 * What to say when typing or a paste didn't all fit: `added` is whether any
 * of it was. The number is in the browser's language, like other numbers.
 */
export function cutMessage(max: number, added: boolean, locale?: string): string {
  const most = new Intl.NumberFormat(locale).format(max);
  return added
    ? `Only part of that fit. This box takes up to ${most} characters, so the rest wasn’t added.`
    : `That didn’t fit. This box takes up to ${most} characters, so it wasn’t added.`;
}
