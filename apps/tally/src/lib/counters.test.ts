import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appSecret, Device, pretendBrowser } from '../../../../tests/unit/sync-devices.ts';
import {
  addCounter,
  changeCount,
  COUNTER_SYNC,
  emptyState,
  isTallyState,
  MAX_COUNTERS,
  MAX_NAME_LENGTH,
  nameError,
  removeCounter,
  resetCounter,
  secondVersion,
  type Counter,
  type TallyState,
} from './counters.ts';

const withWater = (): TallyState => addCounter(emptyState(), '  Water ', 'w');

describe('nameError', () => {
  it('requires a name', () => {
    expect(nameError('   ', emptyState())).toMatch(/Enter a name/);
  });

  it('limits the length', () => {
    expect(nameError('x'.repeat(MAX_NAME_LENGTH), emptyState())).toBeUndefined();
    expect(nameError('x'.repeat(MAX_NAME_LENGTH + 1), emptyState())).toMatch(/characters or fewer/);
    // Audit 5 F2-3: counted as an iPhone's text box counts what fits in it:
    // a family emoji or a flag is one character (10 families counted 80).
    expect(nameError('👨‍👩‍👧'.repeat(10), emptyState())).toBeUndefined();
    expect(nameError('🇬🇪'.repeat(MAX_NAME_LENGTH), emptyState())).toBeUndefined();
    expect(nameError('🇬🇪'.repeat(MAX_NAME_LENGTH + 1), emptyState())).toMatch(/characters or fewer/);
    // One letter under thousands of accents is one character, but not without a limit.
    expect(nameError(`Z${'̶'.repeat(2000)}`, emptyState())).toMatch(/characters or fewer/);
  });

  it('rejects duplicate names, ignoring case, accents and extra spaces', () => {
    expect(nameError('WATER', withWater())).toMatch(/already have/);
    const coffee = addCounter(emptyState(), 'Café  latte', 'c');
    expect(nameError('cafe latte', coffee)).toMatch(/already have/);
    expect(nameError('Café', coffee)).toBeUndefined();
  });

  it('limits the number of counters', () => {
    let state = emptyState();
    for (let index = 0; index < MAX_COUNTERS; index += 1) {
      state = addCounter(state, `c${index}`, `id${index}`);
    }
    expect(nameError('one more', state)).toMatch(/up to/);
  });
});

describe('counters', () => {
  it('adds a trimmed counter starting at zero', () => {
    expect(withWater()).toEqual({ counters: [{ id: 'w', name: 'Water', count: 0 }] });
  });

  it('ignores invalid names', () => {
    const state = withWater();
    expect(addCounter(state, 'water', 'x')).toBe(state);
  });

  it('counts up and down but never below zero', () => {
    let state = withWater();
    state = changeCount(state, 'w', 1);
    state = changeCount(state, 'w', 1);
    expect(state.counters[0]?.count).toBe(2);
    state = changeCount(state, 'w', -5);
    expect(state.counters[0]?.count).toBe(0);
  });

  it('does not change other counters', () => {
    let state = addCounter(withWater(), 'Coffee', 'c');
    state = changeCount(state, 'c', 1);
    expect(state.counters.map((c) => c.count)).toEqual([0, 1]);
  });

  it('resets and removes', () => {
    let state = changeCount(withWater(), 'w', 3);
    state = resetCounter(state, 'w');
    expect(state.counters[0]?.count).toBe(0);
    expect(removeCounter(state, 'w')).toEqual(emptyState());
  });
});

describe('secondVersion', () => {
  it('keeps this device’s count as its own counter, with a name that still fits', () => {
    expect(secondVersion({ id: 'w', name: 'Water', count: 5 }, 'w2')).toEqual({
      id: 'w2',
      name: 'Water (second version)',
      count: 5,
    });
    const long = secondVersion({ id: 'a', name: 'x'.repeat(MAX_NAME_LENGTH), count: 1 }, 'b');
    expect(long.name).toHaveLength(MAX_NAME_LENGTH);
    expect(nameError(long.name, emptyState())).toBeUndefined();
    expect(isTallyState({ counters: [long] })).toBe(true);
  });
});

describe('isTallyState', () => {
  it('accepts valid data', () => {
    expect(isTallyState(withWater())).toBe(true);
    expect(isTallyState(emptyState())).toBe(true);
  });

  it.each([
    null,
    {},
    { counters: 'nope' },
    { counters: [{ id: 'a', name: 'A', count: -1 }] },
    { counters: [{ id: 'a', name: 'A', count: 1.5 }] },
    { counters: [{ id: '', name: 'A', count: 1 }] },
  ])('rejects %j', (value) => {
    expect(isTallyState(value)).toBe(false);
  });
});

describe('counting on two devices before they sync (audit 4 F2-3)', () => {
  beforeEach(() => pretendBrowser('https://tally.shkriuss.app'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Tally's store, synced as the page syncs it. */
  const setup = {
    key: 'tally',
    version: 1,
    fallback: emptyState,
    validate: isTallyState,
    items: (value: TallyState) => value.counters,
    withItems: (value: TallyState, counters: Counter[]) => ({ ...value, counters }),
    ...COUNTER_SYNC,
  };

  it('keeps both counts, also when both counted to the same number', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 26, 12));
    const secret = appSecret();
    const phone = new Device('tally', secret, setup);
    const tablet = new Device('tally', secret, setup);
    phone.save(changeCount(addCounter(emptyState(), 'Water', 'w'), 'w', 5));
    await phone.syncNow();
    await tablet.syncNow();
    expect(tablet.value.counters).toEqual([{ id: 'w', name: 'Water', count: 5 }]);

    // A glass on each, before the tablet syncs: two glasses, not one.
    vi.setSystemTime(Date.now() + 60_000);
    phone.save(changeCount(phone.value, 'w', 1));
    tablet.save(changeCount(tablet.value, 'w', 1));
    await phone.syncNow();
    vi.setSystemTime(Date.now() + 60_000);
    await tablet.syncNow();
    await phone.syncNow();
    const counts = (device: typeof phone) =>
      device.value.counters.map((counter) => `${counter.name}: ${counter.count}`);
    expect(counts(tablet)).toEqual(['Water: 6', 'Water (second version): 6']);
    expect(counts(phone)).toEqual(counts(tablet));

    // Counting on one device only, as usual: one counter.
    vi.setSystemTime(Date.now() + 60_000);
    phone.save(changeCount(phone.value, 'w', 1));
    await phone.syncNow();
    await tablet.syncNow();
    expect(counts(tablet)).toEqual(['Water: 7', 'Water (second version): 6']);
  });

  const counts = (device: Device<TallyState, Counter>) =>
    device.value.counters.map((counter) => `${counter.name}: ${counter.count}`);

  // From review: a reset on both devices was kept twice too.
  it('a reset on both devices is one change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 26, 12));
    const secret = appSecret();
    const phone = new Device('tally', secret, setup);
    const tablet = new Device('tally', secret, setup);
    phone.save(changeCount(addCounter(emptyState(), 'Water', 'w'), 'w', 5));
    await phone.syncNow();
    await tablet.syncNow();
    vi.setSystemTime(Date.now() + 60_000);
    phone.save(resetCounter(phone.value, 'w'));
    tablet.save(resetCounter(tablet.value, 'w'));
    await phone.syncNow();
    vi.setSystemTime(Date.now() + 60_000);
    await tablet.syncNow();
    await phone.syncNow();
    expect(counts(tablet)).toEqual(['Water: 0']);
    expect(counts(phone)).toEqual(['Water: 0']);
  });

  // From review: two tabs on one device, both syncing when it's back online,
  // each noted the one glass at a moment of its own, and it was kept twice.
  it('a glass counted with two tabs open is one glass, whichever tab syncs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 26, 12));
    const phone = new Device('tally', appSecret(), setup);
    const otherTab = phone.anotherTab();
    phone.save(changeCount(addCounter(emptyState(), 'Water', 'w'), 'w', 5));
    await phone.syncNow();
    vi.setSystemTime(Date.now() + 60_000);
    // Offline, a glass.
    phone.save(changeCount(phone.value, 'w', 1));

    // Back online, both tabs sync at once; the first upload's answer is late.
    const real = globalThis.fetch;
    const waiting: {
      method: string;
      answer: () => Promise<Response>;
      send: (r: Response) => void;
    }[] = [];
    let held = true;
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      held
        ? new Promise<Response>((send) =>
            waiting.push({ method: init?.method ?? 'GET', answer: () => real(input, init), send }),
          )
        : real(input, init),
    );
    const until = async (done: () => boolean) => {
      for (let tries = 0; tries < 1000 && !done(); tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    };
    let otherDone = false;
    const first = phone.sync.syncNow();
    await until(() => waiting.length === 1);
    vi.setSystemTime(Date.now() + 7);
    const second = otherTab.syncNow().then(() => {
      otherDone = true;
    });
    // The other tab asks for the copy too, or (taking turns) waits for its turn.
    await until(() => otherDone || waiting.length === 2);
    // The first tab's upload reaches the server; its answer comes after the other tab is done.
    const answer = async (entry: (typeof waiting)[number]) => entry.send(await entry.answer());
    await answer(waiting.shift() as (typeof waiting)[number]);
    await until(() => waiting.some((entry) => entry.method === 'PUT'));
    const upload = waiting.splice(
      waiting.findIndex((entry) => entry.method === 'PUT'),
      1,
    )[0] as (typeof waiting)[number];
    const uploaded = await upload.answer();
    while (!otherDone) {
      const next = waiting.shift();
      if (next) await answer(next);
      else await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await second;
    upload.send(uploaded);
    await first;
    held = false;
    vi.stubGlobal('fetch', real);
    await otherTab.syncNow();
    await phone.syncNow();
    expect(counts(phone)).toEqual(['Water: 6']);
  });
});
