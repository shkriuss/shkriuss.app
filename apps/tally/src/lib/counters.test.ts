import { describe, expect, it } from 'vitest';
import {
  addCounter,
  changeCount,
  emptyState,
  isTallyState,
  MAX_COUNTERS,
  MAX_NAME_LENGTH,
  nameError,
  removeCounter,
  resetCounter,
  secondVersion,
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
  });

  it('rejects duplicate names, ignoring case', () => {
    expect(nameError('WATER', withWater())).toMatch(/already have/);
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
