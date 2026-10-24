/**
 * How an app's data from two devices becomes one (docs/adr/0010):
 *
 * - Data is a list of items, each with a string `id` (Calendar's events,
 *   Tally's counters).
 * - Each item carries the time it last changed. When both devices have an
 *   item, the newest edit wins. An edit's time is always after the version
 *   it was made from, even if this device's clock is behind.
 * - Deleting an item leaves a small marker (a "tombstone") with the time, so
 *   the deletion reaches the other devices instead of the item coming back.
 *   Markers are dropped after 180 days. A device away longer still deletes
 *   an item it saw online that the copy no longer has (dropForgotten).
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

/**
 * What a device remembers about each item since the last sync: a fingerprint
 * of its value then (empty if that's unknown, see upgradeKnown), and its time.
 */
export interface Known {
  items: Record<string, { h: string; t: number } | Tombstone>;
  order: Order;
  /** The data version the fingerprints are of (missing in what older versions saved). */
  v?: number;
}

/** An item in an app's data. */
export interface Identified {
  id: string;
}

/** Deletion markers are dropped after this long (dropForgotten handles devices away longer). */
export const TOMBSTONE_DAYS = 180;

export const isTombstone = (entry: Entry | Known['items'][string]): entry is Tombstone =>
  'deleted' in entry && entry.deleted;

/**
 * Items by id, kept in an object without a prototype, so every id is just a
 * key. A calendar file can give an event any id: "__proto__" or
 * "constructor" must never reach an object's built-in parts.
 */
export const byId = <T>(from: Record<string, T> = {}): Record<string, T> =>
  Object.assign(Object.create(null) as Record<string, T>, from);

/** A record's own entry for an id (what's read from JSON still has a prototype). */
const own = <T>(record: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

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

/** Whether the items both lists have are in the same order: adding or deleting an item isn't a move. */
function sameRelativeOrder(before: readonly string[], after: readonly string[]): boolean {
  const had = new Set(before);
  const kept = new Set(after);
  return sameIds(
    before.filter((id) => kept.has(id)),
    after.filter((id) => had.has(id)),
  );
}

/**
 * This device's items as a snapshot: items that differ from what was known
 * at the last sync (or are new) get the time `now`, and items that are gone
 * become tombstones. If this device's clock is behind, a change still gets a
 * time just after the version it was made from. Also returns whether
 * anything changed.
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
  const items = byId<Entry>();
  // A change made from a version counts as newer than it, even on a device
  // whose clock is behind the one that made that version.
  const stamp = (previous: { t: number } | undefined) =>
    known === undefined ? 0 : Math.max(now, previous ? previous.t + 1 : 0);
  let changed = known === undefined;
  for (const item of current) {
    const previous = known && own(known.items, item.id);
    const h = fingerprint(item);
    const same = previous !== undefined && !isTombstone(previous) && previous.h === h;
    if (!same) changed = true;
    items[item.id] = { t: same ? previous.t : stamp(previous), value: item };
  }
  for (const [id, previous] of Object.entries(known?.items ?? {})) {
    if (id in items) continue;
    if (isTombstone(previous)) {
      items[id] = previous;
    } else {
      items[id] = { t: stamp(previous), deleted: true };
      changed = true;
    }
  }
  const ids = current.map((item) => item.id);
  if (known === undefined || !sameIds(known.order.ids, ids)) changed = true;
  // Only a move makes this order win over another device's: adding or
  // deleting an item would undo a move made there (audit E-12).
  const moved = known === undefined || !sameRelativeOrder(known.order.ids, ids);
  const order = { ids, t: moved ? stamp(known?.order) : known.order.t };
  return { snapshot: { v: version, items, order }, changed };
}

/**
 * After an update that changed the data version: what a device knew from
 * its last sync are fingerprints of the old version's values, so every item
 * would look edited, and win over newer edits on other devices. This brings
 * them to `version`. An item still as it was then gets the fingerprint of
 * its upgraded value, keeping its time. An item changed (or deleted) here
 * since gets an empty fingerprint: it counts as edited, and as its value
 * then is unknown, keepBoth leaves it to the newest edit.
 *
 * `old` is this device's items as still saved in the old version, by id, to
 * tell which changed. If they're gone (the app has saved since), the items
 * here are taken as unchanged, rather than all counting as edited.
 */
export function upgradeKnown(
  known: Known,
  current: readonly Identified[],
  old: ReadonlyMap<string, unknown> | null,
  version: number,
): Known {
  const here = new Map(current.map((item) => [item.id, item]));
  const items = byId(known.items);
  for (const [id, entry] of Object.entries(known.items)) {
    if (isTombstone(entry)) continue;
    const now = here.get(id);
    const unchanged =
      now !== undefined && (old === null || (old.has(id) && fingerprint(old.get(id)) === entry.h));
    items[id] = { h: unchanged ? fingerprint(now) : '', t: entry.t };
  }
  return { ...known, items, v: version };
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
  const items = byId(a.items);
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
  // The other order's own items go where it put them: just before the item
  // that followed them there, or at the end.
  const placed = new Set(first.ids.filter(live));
  const goBefore = new Map<string | null, string[]>();
  let waiting: string[] = [];
  for (const id of second.ids) {
    if (!placed.has(id)) {
      waiting.push(id);
      continue;
    }
    goBefore.set(id, waiting);
    waiting = [];
  }
  goBefore.set(null, waiting);
  for (const id of first.ids) {
    if (!placed.has(id)) continue;
    goBefore.get(id)?.forEach(add);
    add(id);
  }
  goBefore.get(null)?.forEach(add);
  Object.keys(items).sort().forEach(add);
  const order = sameIds(ids, first.ids) ? first : { ids, t: Math.max(a.order.t, b.order.t) };
  return { v: a.v, items, order };
}

/**
 * For apps that keep both versions instead of letting the newest win (like
 * Notes): looks at what changed both here and on another device since this
 * device's last sync, before merging.
 *
 * - Changed on both: the other device's version keeps the item, and this
 *   device's version becomes a new item, made by `copy` (with a new id). Like
 *   other new items, it goes at the end of the list.
 * - Deleted on one device but changed on the other: the change wins, so no
 *   edit is lost.
 *
 * Returns this device's snapshot to merge, and how many items it kept both of.
 */
export function keepBoth(
  known: Known,
  mine: StoreSnapshot,
  theirs: StoreSnapshot,
  copy: (mine: Identified, theirs: Identified) => Identified,
  now: number,
): { snapshot: StoreSnapshot; kept: number } {
  const items = byId(mine.items);
  const ids = [...mine.order.ids];
  let kept = 0;
  for (const [id, other] of Object.entries(theirs.items)) {
    const before = own(known.items, id);
    const here = items[id];
    // Without what the item was at the last sync, there's no telling where it changed.
    if (!before || isTombstone(before) || before.h === '' || !here) continue;
    if (isTombstone(other)) {
      // Deleted there but changed here: the change wins, even if it's older.
      if (!isTombstone(here) && fingerprint(here.value) !== before.h && here.t <= other.t) {
        items[id] = { ...here, t: other.t + 1 };
      }
      continue;
    }
    const otherValue = fingerprint(other.value);
    if (otherValue === before.h) continue;
    if (isTombstone(here)) {
      items[id] = other;
      continue;
    }
    const hereValue = fingerprint(here.value);
    if (hereValue === before.h || hereValue === otherValue) continue;
    const duplicate = copy(here.value as Identified, other.value as Identified);
    if (duplicate.id in items || Object.hasOwn(theirs.items, duplicate.id)) continue;
    items[id] = other;
    items[duplicate.id] = { t: now, value: duplicate };
    ids.push(duplicate.id);
    kept += 1;
  }
  return { snapshot: { ...mine, items, order: { ...mine.order, ids } }, kept };
}

/**
 * The name for this device's version of an item kept by keepBoth, e.g.
 * "Shopping (second version)". Fits in `max` characters (as JavaScript
 * counts them, never splitting an emoji) by shortening the name, so it
 * passes the app's own checks.
 */
export function secondVersionName(name: string, max: number): string {
  const suffix = ' (second version)';
  let base = '';
  for (const character of name.trim()) {
    if (base.length + character.length > max - suffix.length) break;
    base += character;
  }
  base = base.trimEnd();
  return base ? `${base}${suffix}` : 'Second version'.slice(0, max);
}

/** The live items' values, in order. */
export function valuesOf(snapshot: StoreSnapshot): unknown[] {
  return snapshot.order.ids.flatMap((id) => {
    const entry = own(snapshot.items, id);
    return entry && !isTombstone(entry) ? [entry.value] : [];
  });
}

/**
 * Items this device saw in the online copy (`seen`) that the same copy no
 * longer has, not even as a deletion marker: they were deleted on another
 * device so long ago that the marker was dropped (TOMBSTONE_DAYS). Unless
 * they were changed here since, they're deleted here too, instead of coming
 * back. Only for the very copy that was seen: one started again (a new
 * epoch) never had them.
 */
export function dropForgotten(
  mine: StoreSnapshot,
  theirs: StoreSnapshot,
  seen: Known,
): StoreSnapshot {
  const items = byId(mine.items);
  for (const [id, entry] of Object.entries(mine.items)) {
    const before = own(seen.items, id);
    if (isTombstone(entry) || !before || isTombstone(before)) continue;
    if (Object.hasOwn(theirs.items, id) || fingerprint(entry.value) !== before.h) continue;
    items[id] = { t: before.t, deleted: true };
  }
  return { ...mine, items };
}

/** Drops deletion markers older than TOMBSTONE_DAYS. */
export function prune(snapshot: StoreSnapshot, now: number): StoreSnapshot {
  const cutoff = now - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
  const items = byId<Entry>();
  for (const [id, entry] of Object.entries(snapshot.items)) {
    if (!isTombstone(entry) || entry.t >= cutoff) items[id] = entry;
  }
  return { ...snapshot, items };
}

/** What a device should remember after a sync that ended with `snapshot`. */
export function knownFrom(snapshot: StoreSnapshot): Known {
  const items = byId<Known['items'][string]>();
  for (const [id, entry] of Object.entries(snapshot.items)) {
    items[id] = isTombstone(entry) ? entry : { h: fingerprint(entry.value), t: entry.t };
  }
  return { items, order: snapshot.order, v: snapshot.v };
}

export const sameSnapshot = (a: StoreSnapshot, b: StoreSnapshot): boolean =>
  canonical(a) === canonical(b);
