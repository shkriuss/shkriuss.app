import { describe, expect, it } from 'vitest';
import { defineSettings } from './settings.ts';

type Setting = { id: 'unit'; unit: 'km' | 'mi' } | { id: 'goal'; ml: number };

function isSetting(value: unknown): value is Setting {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  if (item['id'] === 'unit') return item['unit'] === 'km' || item['unit'] === 'mi';
  if (item['id'] === 'goal') return typeof item['ml'] === 'number' && item['ml'] > 0;
  return false;
}

const SETTINGS = defineSettings<Setting>(['unit', 'goal'], isSetting);

describe('settings', () => {
  it('start with none changed: every setting at its default', () => {
    const state = SETTINGS.empty();
    expect(state).toEqual({ settings: [] });
    expect(SETTINGS.get(state, 'unit')).toBeUndefined();
    // A new one each time, so changing one never changes another.
    expect(SETTINGS.empty()).not.toBe(state);
  });

  it('change one at a time, kept in the order of their ids', () => {
    const goal = SETTINGS.set(SETTINGS.empty(), { id: 'goal', ml: 2000 });
    const both = SETTINGS.set(goal, { id: 'unit', unit: 'mi' });
    expect(both.settings).toEqual([
      { id: 'unit', unit: 'mi' },
      { id: 'goal', ml: 2000 },
    ]);
    const changed = SETTINGS.set(both, { id: 'goal', ml: 2500 });
    expect(SETTINGS.get(changed, 'goal')?.ml).toBe(2500);
    expect(SETTINGS.get(changed, 'unit')?.unit).toBe('mi');
    expect(changed.settings).toHaveLength(2);
    // The state it was given stays as it was.
    expect(goal.settings).toEqual([{ id: 'goal', ml: 2000 }]);
  });

  it('keep the same state for a setting that doesn’t look right', () => {
    const state = SETTINGS.set(SETTINGS.empty(), { id: 'goal', ml: 2000 });
    expect(SETTINGS.set(state, { id: 'goal', ml: -1 })).toBe(state);
    expect(SETTINGS.set(state, { id: 'unit', unit: 'yards' } as unknown as Setting)).toBe(state);
  });

  it('take from sync only the ones that look right, once each', () => {
    expect(
      SETTINGS.fromItems([
        { id: 'goal', ml: 2000 },
        { id: 'unit', unit: 'yards' },
        { id: 'theme', value: 'dark' },
        null,
        'unit',
        { id: 'unit', unit: 'km' },
        { id: 'unit', unit: 'mi' },
      ]),
    ).toEqual({
      settings: [
        { id: 'unit', unit: 'km' },
        { id: 'goal', ml: 2000 },
      ],
    });
    expect(SETTINGS.fromItems([])).toEqual({ settings: [] });
  });

  it('check saved settings', () => {
    expect(SETTINGS.isState({ settings: [] })).toBe(true);
    expect(SETTINGS.isState({ settings: [{ id: 'unit', unit: 'km' }] })).toBe(true);
    expect(SETTINGS.isState({ settings: [{ id: 'unit', unit: 'yards' }] })).toBe(false);
    expect(SETTINGS.isState({ settings: [{ id: 'theme', value: 'dark' }] })).toBe(false);
    expect(SETTINGS.isState({ settings: {} })).toBe(false);
    expect(SETTINGS.isState({})).toBe(false);
    expect(SETTINGS.isState(null)).toBe(false);
    expect(SETTINGS.isState('settings')).toBe(false);
  });
});
