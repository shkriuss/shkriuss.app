/**
 * The links the hub opens an app with, read by every app as it starts
 * ("#connect=…" coming back from the Account page, "#sync=off&proof=…" from
 * its list of apps). Kept apart from ./connect.ts, which an app loads only
 * when one of these links opens it or sync is turned on (audit 5 J-2), so
 * reading the address costs every page no more than this.
 */

/** A connect request is good for this long. */
export const CONNECT_LIFETIME_MS = 15 * 60 * 1000;

export type ConnectResult =
  { kind: 'cancelled' } | { kind: 'sealed'; hubKey: string; sealed: string };

/** Step 3 (app): reads "#connect=…" from the address, or null if it isn't one. */
export function parseConnectResult(hash: string): ConnectResult | null {
  if (hash === '#connect=cancelled') return { kind: 'cancelled' };
  const match = /^#connect=([A-Za-z0-9_-]{87})\.([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? { kind: 'sealed', hubKey: match[1] ?? '', sealed: match[2] ?? '' } : null;
}

/** Reads the proof from "#sync=off&proof=…", or null if the address isn't one. */
export function parseTurnOff(hash: string): string | null {
  return /^#sync=off&proof=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1] ?? null;
}
