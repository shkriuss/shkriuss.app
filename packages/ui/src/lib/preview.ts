/**
 * Previews of a change (a pull request) run at `*.workers.dev` addresses,
 * like https://pr-7-tally.shkriuss.workers.dev, with storage of their own.
 * They look just like the real sites, so every page says it's a preview
 * (audit D-2): someone trying sync there mustn't type their real recovery
 * key into a pull request's code that isn't merged yet. The server tells
 * previews apart the same way (limitFor in packages/server/src/meter.ts).
 */

/** Whether a page at this host name is a preview, not the real site. */
export const isPreviewHost = (hostname: string): boolean =>
  hostname.toLowerCase().endsWith('.workers.dev');
