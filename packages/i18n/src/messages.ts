import type { Format } from "./format.ts";

/**
 * Messages, the UI's text (ADR 0012): functions from their inputs to strings, which write
 * numbers, dates and lists with the UI's formats.
 */
export type Messages<M> = { readonly [K in keyof M]: (...inputs: never) => string };

/**
 * A message module: `define` gives the module's messages for the UI's formats.
 *
 * ```ts
 * export const messages = defineMessages((format) => ({
 *   title: () => "Notes",
 *   count: (count: number) => format.plural(count, { one: "# note", other: "# notes" }),
 * }));
 *
 * const m = messages(format); // m.count(3) is "3 notes"
 * ```
 *
 * The result gives the same frozen messages for the same formats, so calling it on every render
 * costs nothing.
 */
export function defineMessages<const M extends Messages<M>>(
  define: (format: Format) => M,
): (format: Format) => Readonly<M> {
  const made = new WeakMap<Format, Readonly<M>>();
  return (format) => {
    let messages = made.get(format);
    if (messages === undefined) {
      messages = Object.freeze(define(format));
      made.set(format, messages);
    }
    return messages;
  };
}
