/**
 * How an app's data from two devices becomes one (docs/adr/0010):
 *
 * - Data is a list of items, each with a string `id` (Calendar's events,
 *   Tally's counters).
 * - Each item carries the time it last changed. When both devices have an
 *   item, the newest edit wins.
 * - Deleting an item leaves a small marker (a "tombstone") with the time, so
 *   the deletion reaches the other devices instead of the item coming back.
 *   Markers are dropped after 180 days.
 * - The order of the list is one more thing that changes over time: the
 *   newest order wins, and new items from the other device go at the end.
 *
 * A device doesn't record the moment of each edit. It remembers a
 * fingerprint of each item from the last sync, and an item whose
 * fingerprint changed counts as edited when the device next looks (that's
 * straight after saving).
 */

export interface ItemEntry {
  t: number;
  value: unknown;
}
export interface Tombstone {
  t: number;
  deleted: true;
}
export type Entry = ItemEntry | Tombstone;

export interface Order {
  ids: string[];
  t: number;
}

/** One store's items as they travel between devices (inside the encryption). */
export interface StoreSnapshot {
  /** The store's data version when written (Store.version). */
  v: number;
  items: Record<string, Entry>;
  order: Order;
}

/** What a device remembers about each item since the last sync. */
export interface Known {
  items: Record<string, { h: string; t: number } | Tombstone>;
  order: Order;
}

/** An item in an app's data. */
export interface Identified {
  id: string;
}

/** Deleted items are forgotten after this long (devices offline longer may bring them back). */
export const TOMBSTONE_DAYS = 180;

export const isTombstone = (entry: Entry | Known['items'][string]): entry is Tombstone =>
  'deleted' in entry && entry.deleted;

/** JSON with object keys sorted, so equal values always give equal text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short fingerprint of a value (cyrb53: fast, not cryptographic; only for spotting changes). */
export function fingerprint(value: unknown): string {
  const text = canonical(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * This device's items as a snapshot: items that differ from what was known
 * at the last sync (or are new) get the time `now`, and items that are gone
 * become tombstones. Also returns whether anything changed.
 *
 * On a device's first sync (nothing known yet) everything gets time 0: what's
 * already online wins for items both have (say, after restoring an old
 * backup), and the device's other items are added after the others.
 */
export function observe(
  known: Known | undefined,
  current: readonly Identified[],
  version: number,
  now: number,
): { snapshot: StoreSnapshot; changed: boolean } {
  const items: Record<string, Entry> = {};
  const stamp = known === undefined ? 0 : now;
  let changed = known === undefined;
  for (const item of current) {
    const previous = known?.items[item.id];
    const h = fingerprint(item);
    const same = previous !== undefined && !isTombstone(previous) && previous.h === h;
    if (!same) changed = true;
    items[item.id] = { t: same ? previous.t : stamp, value: item };
  }
  for (const [id, previous] of Object.entries(known?.items ?? {})) {
    if (id in items) continue;
    if (isTombstone(previous)) {
      items[id] = previous;
    } else {
      items[id] = { t: now, deleted: true };
      changed = true;
    }
  }
  const ids = current.map((item) => item.id);
  const orderSame = known !== undefined && sameIds(known.order.ids, ids);
  if (!orderSame) changed = true;
  const order = { ids, t: orderSame ? known.order.t : stamp };
  return { snapshot: { v: version, items, order }, changed };
}

/** Which of two entries for the same item wins: the newer one; ties broken the same way on every device. */
function newer(a: Entry, b: Entry): Entry {
  if (a.t !== b.t) return a.t > b.t ? a : b;
  if (isTombstone(a) !== isTombstone(b)) return isTombstone(a) ? a : b;
  const fa = isTombstone(a) ? '' : fingerprint(a.value);
  const fb = isTombstone(b) ? '' : fingerprint(b.value);
  return fa >= fb ? a : b;
}

/** Merges two devices' snapshots of one store (same data version). */
export function merge(a: StoreSnapshot, b: StoreSnapshot): StoreSnapshot {
  const items: Record<string, Entry> = { ...a.items };
  for (const [id, entry] of Object.entries(b.items)) {
    const other = items[id];
    items[id] = other ? newer(other, entry) : entry;
  }
  const live = (id: string) => {
    const entry = items[id];
    return entry !== undefined && !isTombstone(entry);
  };
  const [first, second] =
    a.order.t !== b.order.t
      ? a.order.t > b.order.t
        ? [a.order, b.order]
        : [b.order, a.order]
      : canonical(a.order.ids) >= canonical(b.order.ids)
        ? [a.order, b.order]
        : [b.order, a.order];
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (live(id) && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  first.ids.forEach(add);
  second.ids.forEach(add);
  Object.keys(items).sort().forEach(add);
  const order = sameIds(ids, first.ids) ? first : { ids, t: Math.max(a.order.t, b.order.t) };
  return { v: a.v, items, order };
}

/** The live items' values, in order. */
export function valuesOf(snapshot: StoreSnapshot): unknown[] {
  return snapshot.order.ids.flatMap((id) => {
    const entry = snapshot.items[id];
    return entry && !isTombstone(entry) ? [entry.value] : [];
  });
}

/** Drops deletion markers older than TOMBSTONE_DAYS. */
export function prune(snapshot: StoreSnapshot, now: number): StoreSnapshot {
  const cutoff = now - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  const items = Object.fromEntries(
    Object.entries(snapshot.items).filter(([, entry]) => !isTombstone(entry) || entry.t >= cutoff),
  );
  return { ...snapshot, items };
}

/** What a device should remember after a sync that ended with `snapshot`. */
export function knownFrom(snapshot: StoreSnapshot): Known {
  const items: Known['items'] = {};
  for (const [id, entry] of Object.entries(snapshot.items)) {
    items[id] = isTombstone(entry) ? entry : { h: fingerprint(entry.value), t: entry.t };
  }
  return { items, order: snapshot.order };
}

export const sameSnapshot = (a: StoreSnapshot, b: StoreSnapshot): boolean =>
  canonical(a) === canonical(b);
