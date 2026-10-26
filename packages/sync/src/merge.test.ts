import { describe, expect, it } from 'vitest';
import {
  canonical,
  dropForgotten,
  fingerprint,
  keepBoth,
  knownFrom,
  merge,
  observe,
  prune,
  sameSnapshot,
  secondVersionName,
  TOMBSTONE_DAYS,
  upgradeKnown,
  valuesOf,
  type Entry,
  type Identified,
  type Known,
  type StoreSnapshot,
} from './merge.ts';

interface Counter extends Identified {
  name: string;
  count: number;
}
const counter = (id: string, count = 0, name = id): Counter => ({ id, name, count });

const DAY = 24 * 60 * 60 * 1000;

/** One device: its items, and what it knew at its last sync. */
class Device {
  items: Counter[];
  known: Known | undefined;
  constructor(items: Counter[] = []) {
    this.items = items;
  }
  snapshot(now: number) {
    return observe(this.known, this.items, 1, now);
  }
  /** Syncs with the "server" copy; returns the new server copy. */
  sync(server: StoreSnapshot | undefined, now: number): StoreSnapshot {
    const { snapshot } = this.snapshot(now);
    const merged = server ? merge(snapshot, server) : snapshot;
    this.items = valuesOf(merged) as Counter[];
    this.known = knownFrom(merged);
    return merged;
  }
}

describe('canonical and fingerprint', () => {
  it('ignore key order but not values', () => {
    expect(canonical({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint('x')).not.toBe(fingerprint('y'));
  });
});

describe('observe', () => {
  it('stamps new and changed items with now, keeps the time of unchanged ones', () => {
    const known = knownFrom(observe(undefined, [counter('a')], 1, 100).snapshot);
    const next = observe(known, [counter('a'), counter('b')], 1, 200);
    expect(next.changed).toBe(true);
    expect(next.snapshot.items).toEqual({
      a: { t: 0, value: counter('a') },
      b: { t: 200, value: counter('b') },
    });

    const same = observe(knownFrom(next.snapshot), [counter('a'), counter('b')], 1, 300);
    expect(same.changed).toBe(false);
    expect(same.snapshot).toEqual(next.snapshot);

    const edited = observe(knownFrom(next.snapshot), [counter('a', 5), counter('b')], 1, 400);
    expect(edited.changed).toBe(true);
    expect(edited.snapshot.items['a']).toEqual({ t: 400, value: counter('a', 5) });
    expect(edited.snapshot.items['b']).toEqual({ t: 200, value: counter('b') });
  });

  it('on a first sync, gives everything time 0 so what’s online wins', () => {
    const first = observe(undefined, [counter('a'), counter('b')], 1, 100);
    expect(first.changed).toBe(true);
    expect(first.snapshot.items).toEqual({
      a: { t: 0, value: counter('a') },
      b: { t: 0, value: counter('b') },
    });
    expect(first.snapshot.order).toEqual({ ids: ['a', 'b'], t: 0 });

    const online = new Device([counter('a', 5)]);
    online.known = knownFrom(observe(undefined, [], 1, 50).snapshot);
    const server = online.sync(undefined, 60);
    expect(merge(first.snapshot, server).items['a']).toEqual({ t: 60, value: counter('a', 5) });
  });

  it('turns removed items into tombstones, and keeps old tombstones', () => {
    const known = knownFrom(observe(undefined, [counter('a'), counter('b')], 1, 100).snapshot);
    expect(known.items['b']).toEqual({ h: fingerprint(counter('b')), t: 0 });
    const removed = observe(known, [counter('a')], 1, 200);
    expect(removed.changed).toBe(true);
    expect(removed.snapshot.items['b']).toEqual({ t: 200, deleted: true });
    const later = observe(knownFrom(removed.snapshot), [counter('a')], 1, 300);
    expect(later.changed).toBe(false);
    expect(later.snapshot.items['b']).toEqual({ t: 200, deleted: true });
  });

  it('stamps a change later than the version it was made from, even with a clock behind', () => {
    const synced: StoreSnapshot = {
      v: 1,
      items: { a: { t: 1000, value: counter('a') }, b: { t: 1000, value: counter('b') } },
      order: { ids: ['a', 'b'], t: 1000 },
    };
    // This device's clock says 400.
    const next = observe(knownFrom(synced), [counter('a', 5)], 1, 400).snapshot;
    expect(next.items).toEqual({
      a: { t: 1001, value: counter('a', 5) },
      b: { t: 1001, deleted: true },
    });
    // Deleting an item isn't a move: the order keeps its time (audit E-12).
    expect(next.order.t).toBe(1000);
    expect(valuesOf(merge(synced, next))).toEqual([counter('a', 5)]);
  });

  it('notices a new order', () => {
    const known = knownFrom(observe(undefined, [counter('a'), counter('b')], 1, 100).snapshot);
    const moved = observe(known, [counter('b'), counter('a')], 1, 200);
    expect(moved.changed).toBe(true);
    expect(moved.snapshot.order).toEqual({ ids: ['b', 'a'], t: 200 });
  });

  it('takes adding or deleting an item as no move', () => {
    const synced = observe(undefined, [counter('a'), counter('b')], 1, 100).snapshot;
    const known = { ...knownFrom(synced), order: { ids: ['a', 'b'], t: 100 } };
    const added = observe(known, [counter('c'), counter('a')], 1, 200);
    expect(added.changed).toBe(true);
    expect(added.snapshot.order).toEqual({ ids: ['c', 'a'], t: 100 });
  });
});

describe('merge', () => {
  it('combines items only one side has', () => {
    const phone = new Device([counter('water')]);
    const tablet = new Device([counter('steps')]);
    let server = phone.sync(undefined, 100);
    server = tablet.sync(server, 200);
    phone.sync(server, 300);
    expect(phone.items).toEqual([counter('water'), counter('steps')]);
    expect(tablet.items).toEqual(phone.items);
  });

  it('keeps the newest edit of each item', () => {
    const phone = new Device([counter('a'), counter('b')]);
    let server = phone.sync(undefined, 100);
    const tablet = new Device();
    server = tablet.sync(server, 150);

    // Both edit while offline: phone edits a (later), tablet edits a (earlier) and b.
    tablet.items = [counter('a', 1), counter('b', 7)];
    phone.items = [counter('a', 2), counter('b')];
    const fromTablet = tablet.sync(server, 200);
    server = phone.sync(fromTablet, 300);
    tablet.sync(server, 400);

    expect(phone.items).toEqual([counter('a', 2), counter('b', 7)]);
    expect(tablet.items).toEqual(phone.items);
  });

  it('syncs deletions instead of bringing items back', () => {
    const phone = new Device([counter('a'), counter('b')]);
    let server = phone.sync(undefined, 100);
    const tablet = new Device();
    server = tablet.sync(server, 150);

    phone.items = [counter('a')];
    server = phone.sync(server, 200);
    server = tablet.sync(server, 300);
    expect(tablet.items).toEqual([counter('a')]);
    expect(server.items['b']).toEqual({ t: 200, deleted: true });
  });

  it('lets an edit made after a deletion win', () => {
    const phone = new Device([counter('a')]);
    let server = phone.sync(undefined, 100);
    const tablet = new Device();
    server = tablet.sync(server, 110);

    phone.items = [];
    const deleted = phone.sync(server, 200);
    tablet.items = [counter('a', 9)];
    tablet.sync(deleted, 300);
    expect(tablet.items).toEqual([counter('a', 9)]);
  });

  it('gives the same result whichever device merges', () => {
    const a: StoreSnapshot = observe(undefined, [counter('x', 1), counter('y')], 1, 100).snapshot;
    const b: StoreSnapshot = observe(
      undefined,
      [counter('y', 3), counter('x', 2)],
      1,
      100,
    ).snapshot;
    expect(canonical(merge(a, b))).toBe(canonical(merge(b, a)));
  });

  it('uses the newest order, then adds the other device’s new items where it put them', () => {
    const phone = new Device([counter('a'), counter('b')]);
    let server = phone.sync(undefined, 100);
    const tablet = new Device();
    server = tablet.sync(server, 150);

    phone.items = [counter('b'), counter('a')];
    tablet.items = [counter('a'), counter('b'), counter('c')];
    const fromTablet = tablet.sync(server, 200);
    server = phone.sync(fromTablet, 300);
    expect(phone.items.map((item) => item.id)).toEqual(['b', 'a', 'c']);
    tablet.sync(server, 400);
    expect(tablet.items).toEqual(phone.items);
  });

  it('doesn’t undo a move made elsewhere when an item is added or deleted (audit E-12)', () => {
    const phone = new Device([counter('a'), counter('b'), counter('c')]);
    let server = phone.sync(undefined, 100);
    const tablet = new Device();
    server = tablet.sync(server, 150);

    // The phone moves c to the top; a minute later, before syncing, the
    // tablet adds d at the top and deletes b.
    phone.items = [counter('c'), counter('a'), counter('b')];
    server = phone.sync(server, 200);
    tablet.items = [counter('d'), counter('a'), counter('c')];
    server = tablet.sync(server, 260);
    expect(tablet.items.map((item) => item.id)).toEqual(['c', 'd', 'a']);
    phone.sync(server, 300);
    expect(phone.items).toEqual(tablet.items);
  });

  it('says when nothing changed', () => {
    const snapshot = observe(undefined, [counter('a')], 1, 100).snapshot;
    expect(sameSnapshot(merge(snapshot, snapshot), snapshot)).toBe(true);
  });
});

describe('keepBoth', () => {
  const copy = (mine: Identified) => ({ ...(mine as Counter), id: `${mine.id}-copy` });

  /** Two devices that synced `items`, then each changed things. */
  function synced(items: Counter[]) {
    const phone = new Device(items);
    const server = phone.sync(undefined, 1000);
    const tablet = new Device();
    tablet.sync(server, 1000);
    return { phone, tablet, server };
  }

  it('keeps both versions of an item changed on two devices', () => {
    const { phone, tablet } = synced([counter('a'), counter('b')]);
    phone.items = [counter('a', 5), counter('b')];
    const server = phone.sync(undefined, 2000);
    tablet.items = [counter('a', 7), counter('b')];
    const mine = tablet.snapshot(3000).snapshot;
    const result = keepBoth(tablet.known as Known, mine, server, copy, 3000);
    expect(result.kept).toBe(1);
    const merged = merge(result.snapshot, server);
    expect(valuesOf(merged)).toEqual([counter('a', 5), counter('b'), counter('a-copy', 7, 'a')]);
  });

  it('leaves items changed on one side only, or changed the same way, to the merge', () => {
    const { phone, tablet } = synced([counter('a'), counter('b'), counter('c')]);
    phone.items = [counter('a', 5), counter('b'), counter('c', 2)];
    const server = phone.sync(undefined, 2000);
    tablet.items = [counter('a'), counter('b', 3), counter('c', 2)];
    const mine = tablet.snapshot(3000).snapshot;
    const result = keepBoth(tablet.known as Known, mine, server, copy, 3000);
    expect(result).toEqual({ snapshot: mine, kept: 0 });
    expect(valuesOf(merge(result.snapshot, server))).toEqual([
      counter('a', 5),
      counter('b', 3),
      counter('c', 2),
    ]);
  });

  it('brings back an item deleted here but changed on the other device', () => {
    const { phone, tablet } = synced([counter('a'), counter('b')]);
    phone.items = [counter('a', 5), counter('b')];
    const server = phone.sync(undefined, 2000);
    tablet.items = [counter('b')];
    const mine = tablet.snapshot(3000).snapshot;
    const result = keepBoth(tablet.known as Known, mine, server, copy, 3000);
    // Back where it was: deleting isn't a move.
    expect(valuesOf(merge(result.snapshot, server))).toEqual([counter('a', 5), counter('b')]);
  });

  it('keeps an item changed here but deleted on the other device', () => {
    const { phone, tablet } = synced([counter('a'), counter('b')]);
    phone.items = [counter('b')];
    const server = phone.sync(undefined, 3000);
    tablet.items = [counter('a', 4), counter('b')];
    const mine = tablet.snapshot(2000).snapshot;
    const result = keepBoth(tablet.known as Known, mine, server, copy, 2000);
    // Where it was: deleting isn't a move.
    expect(valuesOf(merge(result.snapshot, server))).toEqual([counter('a', 4), counter('b')]);
  });

  it('still syncs a deletion made on the other device', () => {
    const { phone, tablet } = synced([counter('a'), counter('b')]);
    phone.items = [counter('b')];
    const server = phone.sync(undefined, 2000);
    tablet.items = [counter('a'), counter('b', 1)];
    const mine = tablet.snapshot(3000).snapshot;
    const result = keepBoth(tablet.known as Known, mine, server, copy, 3000);
    expect(result.kept).toBe(0);
    expect(valuesOf(merge(result.snapshot, server))).toEqual([counter('b', 1)]);
  });

  // Audit 4 F2-3: Tally's water at 5, counted once on each device, was 6
  // on both, and one counter of 6 after they synced: a glass was lost.
  it('with `keepSame`, keeps both of the same change made on two devices', () => {
    const { phone, tablet } = synced([counter('a', 5)]);
    phone.items = [counter('a', 6)];
    const server = phone.sync(undefined, 2000);
    tablet.items = [counter('a', 6)];
    const mine = tablet.snapshot(3000).snapshot;
    // Without it, one edit (text changed the same way on both, say).
    expect(keepBoth(tablet.known as Known, mine, server, copy, 3000).kept).toBe(0);
    const both = keepBoth(tablet.known as Known, mine, server, copy, 3000, true);
    expect(both.kept).toBe(1);
    expect(valuesOf(merge(both.snapshot, server))).toEqual([
      counter('a', 6),
      counter('a-copy', 6, 'a'),
    ]);
    // This device's own change, back from an upload whose answer was lost
    // (made at the same moment), isn't kept twice.
    expect(keepBoth(tablet.known as Known, mine, mine, copy, 3000, true).kept).toBe(0);
  });
});

describe('ids', () => {
  // A calendar file can give an event any id, such as "__proto__".
  const odd = [counter('__proto__'), counter('constructor'), counter('toString')];

  it('are only ever keys, whatever they are', () => {
    const mine = observe(undefined, [counter('a'), ...odd], 1, 100).snapshot;
    const theirs = observe(undefined, [counter('a')], 1, 100).snapshot;
    const merged = merge(mine, theirs);
    expect(valuesOf(merged)).toEqual([counter('a'), ...odd]);
    expect(valuesOf(prune(merged, 200))).toEqual([counter('a'), ...odd]);

    // Deleted, and remembered through the device's saved state (JSON).
    const known = JSON.parse(JSON.stringify(knownFrom(merged))) as Known;
    const deleted = observe(known, [counter('a')], 1, 300).snapshot;
    for (const { id } of odd) expect(deleted.items[id]).toEqual({ t: 300, deleted: true });
    expect(valuesOf(merge(deleted, merged))).toEqual([counter('a')]);
  });

  it('that aren’t there never match something else', () => {
    const known = JSON.parse(JSON.stringify(knownFrom(observe(undefined, [], 1, 100).snapshot)));
    const added = observe(known as Known, odd, 1, 200).snapshot;
    for (const { id } of odd) expect(added.items[id]).toEqual({ t: 200, value: counter(id) });
    const empty = observe(undefined, [], 1, 100).snapshot;
    expect(valuesOf(merge(empty, added))).toEqual(odd);
    const copy = (item: Identified) => ({ ...item, id: `${item.id}-copy` });
    expect(keepBoth(known as Known, added, empty, copy, 300).kept).toBe(0);
  });
});

describe('upgradeKnown', () => {
  // Data version 2 adds a colour to every counter.
  const v2 = (item: Counter) => ({ ...item, color: null });
  const known = knownFrom(
    observe(undefined, [counter('a'), counter('b'), counter('c')], 1, 100).snapshot,
  );
  // Since the last sync, here: b changed and c deleted, still saved in version 1.
  const old = new Map([
    ['a', counter('a')],
    ['b', counter('b', 5)],
  ]);
  const current = [v2(counter('a')), v2(counter('b', 5))];

  it('counts only what changed here since the last sync as edited', () => {
    const next = upgradeKnown(known, current, old, 2);
    expect(next.v).toBe(2);
    expect(next.items).toEqual({
      a: { h: fingerprint(v2(counter('a'))), t: 0 },
      b: { h: '', t: 0 },
      c: { h: '', t: 0 },
    });
    expect(observe(next, current, 2, 500).snapshot.items).toEqual({
      a: { t: 0, value: v2(counter('a')) },
      b: { t: 500, value: v2(counter('b', 5)) },
      c: { t: 500, deleted: true },
    });
  });

  it('takes items as unchanged when the old data is gone', () => {
    expect(upgradeKnown(known, current, null, 2).items).toEqual({
      a: { h: fingerprint(v2(counter('a'))), t: 0 },
      b: { h: fingerprint(v2(counter('b', 5))), t: 0 },
      c: { h: '', t: 0 },
    });
  });

  it('leaves items whose value at the last sync is unknown to the newest edit', () => {
    const next = upgradeKnown(known, current, old, 2);
    const mine = observe(next, current, 2, 500).snapshot;
    const theirs = observe(knownFrom(mine), [v2(counter('a')), v2(counter('b', 7))], 2, 400);
    const copy = (item: Identified) => ({ ...item, id: `${item.id}-copy` });
    expect(keepBoth(next, mine, theirs.snapshot, copy, 500).kept).toBe(0);
  });
});

describe('secondVersionName', () => {
  it('adds "(second version)", shortening the name to fit', () => {
    expect(secondVersionName('  Shopping ', 60)).toBe('Shopping (second version)');
    const long = secondVersionName('x'.repeat(100), 60);
    expect(long).toBe(`${'x'.repeat(43)} (second version)`);
    expect(long).toHaveLength(60);
    const emoji = secondVersionName('😀'.repeat(30), 30);
    expect(emoji.length).toBeLessThanOrEqual(30);
    expect(emoji).toBe('😀😀😀😀😀😀 (second version)');
    expect(secondVersionName('   ', 60)).toBe('Second version');
  });
});

describe('dropForgotten', () => {
  it('deletes what the copy lost without a marker, unless it was changed here', () => {
    const online = observe(
      undefined,
      [counter('gone'), counter('edited'), counter('marked'), counter('kept')],
      1,
      100,
    ).snapshot;
    const seen = knownFrom(online);
    // The copy now: "gone" and "edited" dropped without a marker, "marked" with one.
    const theirs: StoreSnapshot = {
      v: 1,
      items: { marked: { t: 200, deleted: true }, kept: online.items['kept'] as Entry },
      order: { ids: ['kept'], t: 200 },
    };
    const here = [
      counter('gone'),
      counter('edited', 5),
      counter('marked'),
      counter('kept'),
      counter('new'),
    ];
    const mine = observe(seen, here, 1, 300).snapshot;
    const result = dropForgotten(mine, theirs, seen);
    expect(result.items['gone']).toEqual({ t: 0, deleted: true });
    expect(valuesOf(merge(result, theirs))).toEqual([
      counter('edited', 5),
      counter('kept'),
      counter('new'),
    ]);
  });
});

describe('prune', () => {
  it('forgets old deletions only', () => {
    const now = 1_000 * DAY;
    const snapshot: StoreSnapshot = {
      v: 1,
      items: {
        old: { t: now - (TOMBSTONE_DAYS + 1) * DAY, deleted: true },
        recent: { t: now - DAY, deleted: true },
        live: { t: now - 400 * DAY, value: counter('live') },
      },
      order: { ids: ['live'], t: 0 },
    };
    expect(Object.keys(prune(snapshot, now).items).sort()).toEqual(['live', 'recent']);
  });
});

describe('the numbers the docs promise (audit 3 J-4)', () => {
  it('keep deletion markers for 180 days', () => {
    // docs/adr/0010-account-and-sync.md: markers are "dropped after 180 days".
    expect(TOMBSTONE_DAYS).toBe(180);
  });
});
