import { describe, expect, it } from 'vitest';
import {
  apps,
  appOrigin,
  getApp,
  getSite,
  hubOrigin,
  listedApps,
  slugProblems,
  validateRegistry,
} from './index.ts';

const validApp = {
  slug: 'notes',
  name: 'Notes',
  description: 'Write things down.',
  icon: 'tally',
  color: 'teal',
  status: 'live',
  storage: 'device',
  dataStored: ['Your notes'],
};

const validSite = {
  name: 'shkriuss',
  domain: 'shkriuss.app',
  description: 'Apps.',
  icon: 'grid',
  color: 'teal',
};

describe('slugProblems', () => {
  it.each(['tally', 'my-app', 'a1', 'calendar2', 'x'.repeat(30)])('accepts %s', (slug) => {
    expect(slugProblems(slug)).toEqual([]);
  });

  it.each(['', 'a', 'Tally', '1app', 'my_app', 'my--app', 'app-', '-app', 'x'.repeat(31), 'a b'])(
    'rejects %j',
    (slug) => {
      expect(slugProblems(slug)).not.toEqual([]);
    },
  );

  it('rejects reserved and duplicate slugs', () => {
    expect(slugProblems('www')).toEqual(['"www" is reserved.']);
    expect(slugProblems('hub')).toEqual(['"hub" is reserved.']);
    expect(slugProblems('tally', ['tally'])).toEqual(['"tally" is already used by another app.']);
  });
});

describe('validateRegistry', () => {
  it('accepts valid data', () => {
    const registry = validateRegistry({ site: validSite, apps: [validApp] });
    expect(registry.apps[0]?.slug).toBe('notes');
  });

  it('lists every problem at once', () => {
    const bad = {
      site: { ...validSite, color: 'neon' },
      apps: [
        { ...validApp, slug: 'Bad Slug', status: 'gone' },
        { ...validApp, storage: 'device', dataStored: [] },
        validApp,
      ],
    };
    expect(() => validateRegistry(bad)).toThrowError(/site\.color/);
    try {
      validateRegistry(bad);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('apps[0].slug');
      expect(message).toContain('apps[0].status');
      expect(message).toContain('apps[1].dataStored');
      expect(message).toContain('apps[2].slug: "notes" is already used');
    }
  });

  it('accepts an optional pushNotifications flag, true or false only', () => {
    const registry = validateRegistry({
      site: validSite,
      apps: [{ ...validApp, pushNotifications: true }],
    });
    expect(registry.apps[0]?.pushNotifications).toBe(true);
    expect(() =>
      validateRegistry({ site: validSite, apps: [{ ...validApp, pushNotifications: 'yes' }] }),
    ).toThrow(/pushNotifications must be true or false/);
  });

  it('accepts an optional sync flag, true or false only', () => {
    const registry = validateRegistry({ site: validSite, apps: [{ ...validApp, sync: true }] });
    expect(registry.apps[0]?.sync).toBe(true);
    expect(() => validateRegistry({ site: validSite, apps: [{ ...validApp, sync: 1 }] })).toThrow(
      /sync must be true or false/,
    );
  });

  it('rejects non-objects', () => {
    expect(() => validateRegistry(null)).toThrow();
    expect(() => validateRegistry({ site: validSite, apps: {} })).toThrow(
      /"apps" must be an array/,
    );
  });
});

describe('the real apps.json', () => {
  it('is valid and has unique slugs', () => {
    const slugs = apps.map((app) => app.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('hides "hidden" apps from the listing', () => {
    expect(listedApps.every((app) => app.status !== 'hidden')).toBe(true);
  });

  it('builds origins from the domain', () => {
    expect(hubOrigin).toBe('https://shkriuss.app');
    expect(appOrigin('tally')).toBe('https://tally.shkriuss.app');
  });

  it('describes the hub and apps through getSite', () => {
    expect(getSite('hub').kind).toBe('hub');
    const first = apps[0];
    if (first) expect(getSite(first.slug).origin).toBe(appOrigin(first.slug));
  });

  it('throws a helpful error for unknown apps', () => {
    expect(() => getApp('does-not-exist')).toThrow(/No app with slug "does-not-exist"/);
  });
});
