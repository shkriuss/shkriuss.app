/** Choosing which sites the browser tests start (E2E_SITES, audit J-14). */
import { describe, expect, it } from 'vitest';
import { chosenSites } from '../e2e/sites.ts';

const all = ['hub', 'calendar', 'notes', 'tally'];

describe('E2E_SITES', () => {
  it('starts every site when it isn’t set', () => {
    expect(chosenSites(all, undefined)).toEqual(all);
    expect(chosenSites(all, ' ')).toEqual(all);
  });

  it('starts the sites asked for, and always the hub', () => {
    expect(chosenSites(all, 'tally')).toEqual(['hub', 'tally']);
    expect(chosenSites(all, 'notes, calendar,')).toEqual(['hub', 'calendar', 'notes']);
  });

  it('names a site that doesn’t exist', () => {
    expect(() => chosenSites(all, 'tally,notse')).toThrow(/no site called notse/);
  });
});
