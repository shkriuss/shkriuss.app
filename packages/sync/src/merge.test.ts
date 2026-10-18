import { describe, expect, it } from 'vitest';
import {
  canonical,
  fingerprint,
  keepBoth,
  knownFrom,
  merge,
  observe,
  prune,
  sameSnapshot,
  TOMBSTONE_DAYS,
  valuesOf,
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

  it('notices a new order', () => {
    const known = knownFrom(observe(undefined, [counter('a'), counter('b')], 1, 100).snapshot);
    const moved = observe(known, [counter('b'), counter('a')], 1, 200);
    expect(moved.changed).toBe(true);
    expect(moved.snapshot.order).toEqual({ ids: ['b', 'a'], t: 200 });
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

  it('uses the newest order, then adds the other device’s new items at the end', () => {
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
    expect(valuesOf(merge(result.snapshot, server))).toEqual([counter('b'), counter('a', 5)]);
  });

  it('keeps an item changed here but deleted on the other device', () => {
    const { phone, tablet } = synced([counter('a'), counter('b')]);
    phone.items = [counter('b')];
    const server = phone.sync(undefined, 3000);
    tablet.items = [counter('a', 4), counter('b')];
    const mine = tablet.snapshot(2000).snapshot;
    const result = keepBoth(tablet.known as Known, mine, server, copy, 2000);
    expect(valuesOf(merge(result.snapshot, server))).toEqual([counter('b'), counter('a', 4)]);
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
