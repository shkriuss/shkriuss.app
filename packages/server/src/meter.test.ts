import { describe, expect, it } from 'vitest';
import { limitOf, LIMIT_HEADER, meterFetch, OBJECT_BYTES, release, reserve } from './meter.ts';
import { memoryNamespace } from './testing.ts';

const LIMIT = 1_000_000;

/** A namespace of objects that only store what they're told to, metered. */
function namespace() {
  let asked = 0;
  const space = memoryNamespace((state) => ({
    fetch: async (request: Request) => {
      if (new URL(request.url).hostname === 'meter') {
        asked += 1;
        return meterFetch(state, request);
      }
      const { bytes, unmetered } = (await request.json()) as {
        bytes: number | null;
        unmetered?: true;
      };
      if (bytes !== null && unmetered) {
        await state.storage.put('data', 'x'.repeat(bytes));
        return new Response(null, { status: 204 });
      }
      if (bytes === null) {
        await release(state, space.namespace);
        await state.storage.deleteAll();
        return new Response(null, { status: 204 });
      }
      if (!(await reserve(state, space.namespace, bytes, LIMIT))) {
        return new Response(null, { status: 507 });
      }
      await state.storage.put('data', 'x'.repeat(bytes));
      return new Response(null, { status: 204 });
    },
  }));
  const store = (name: string, bytes: number | null, unmetered?: true) =>
    space.namespace
      .get(space.namespace.idFromName(name))
      .fetch('https://object/', { method: 'POST', body: JSON.stringify({ bytes, unmetered }) })
      .then((response) => response.status);
  const total = () => space.objects.get('meter')?.storage.map.get('total');
  return { space, store, total, asked: () => asked };
}

describe('storage meters', () => {
  it('refuse to let the objects together grow past the limit', async () => {
    const { store, total } = namespace();
    // Each also asks for a quarter more, to grow into.
    expect(await store('a', 300_000)).toBe(204);
    expect(await store('b', 300_000)).toBe(204);
    expect(await store('c', 300_000)).toBe(507);
    expect(total()).toBeLessThanOrEqual(LIMIT);
  });

  it('count each object as at least OBJECT_BYTES', async () => {
    const { store } = namespace();
    let stored = 0;
    while ((await store(`tiny-${stored}`, 0)) === 204) stored += 1;
    expect(stored).toBe(Math.floor(LIMIT / OBJECT_BYTES));
  });

  it('always let an object shrink, and give the room to others', async () => {
    const { store, total } = namespace();
    await store('a', 600_000);
    expect(await store('b', 600_000)).toBe(507);
    expect(await store('a', 10_000)).toBe(204);
    expect(await store('b', 600_000)).toBe(204);
    expect(total()).toBeLessThanOrEqual(LIMIT);
  });

  it('forget an object that releases its room', async () => {
    const { space, store, total } = namespace();
    await store('a', 600_000);
    expect(await store('a', null)).toBe(204);
    expect(total()).toBe(0);
    expect([...(space.objects.get('meter')?.storage.map.keys() ?? [])]).toEqual(['total']);
  });

  it('aren’t asked about every small change', async () => {
    const { store, asked } = namespace();
    await store('a', 100_000);
    for (const bytes of [101_000, 99_000, 110_000, 95_000, 120_000]) await store('a', bytes);
    expect(asked()).toBe(1);
  });

  it('leave objects stored before there were meters uncounted until they store more', async () => {
    const { store, total, asked } = namespace();
    expect(await store('old', 300_000, true)).toBe(204);
    // Deleting it doesn't ask: it was never counted.
    expect(await store('old', null)).toBe(204);
    expect(asked()).toBe(0);
    // Storing more is counted from then on.
    expect(await store('old', 300_000)).toBe(204);
    expect(total()).toBeGreaterThan(300_000);
  });
});

describe('limits', () => {
  it('let nothing grow when the Worker didn’t send one', () => {
    expect(limitOf(new Request('https://copy/'))).toBe(0);
    expect(limitOf(new Request('https://copy/', { headers: { [LIMIT_HEADER]: 'lots' } }))).toBe(0);
    expect(limitOf(new Request('https://copy/', { headers: { [LIMIT_HEADER]: '500' } }))).toBe(500);
  });

  it('can be made small in tests, which still see the one the Worker sent', async () => {
    const space = memoryNamespace(
      () => ({ fetch: async (request: Request) => new Response(String(limitOf(request))) }),
      { limit: 300 },
    );
    const object = space.namespace.get(space.namespace.idFromName('a'));
    const answer = await object.fetch('https://object/', { headers: { [LIMIT_HEADER]: '500' } });
    expect(await answer.text()).toBe('300');
    // A request without a limit (to the meter, say) gets none.
    expect(await (await object.fetch('https://object/')).text()).toBe('0');
    expect(space.limits()).toEqual(['500']);
  });
});
