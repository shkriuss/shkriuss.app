import { describe, expect, it } from 'vitest';
import {
  apps,
  appOrigin,
  getApp,
  getSite,
  hub,
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

  it('refuses "storage": "none" for an app that says it stores something', () => {
    expect(() =>
      validateRegistry({
        site: validSite,
        apps: [{ ...validApp, storage: 'none', dataStored: ['Your light or dark theme choice'] }],
      }),
    ).toThrow(/apps\[0\]\.storage can't be "none"/);
    expect(
      validateRegistry({
        site: validSite,
        apps: [{ ...validApp, storage: 'none', dataStored: [] }],
      }).apps,
    ).toHaveLength(1);
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

  it('accepts an optional webAssembly flag, true or false only', () => {
    const registry = validateRegistry({
      site: validSite,
      apps: [{ ...validApp, webAssembly: true }],
    });
    expect(registry.apps[0]?.webAssembly).toBe(true);
    expect(() =>
      validateRegistry({ site: validSite, apps: [{ ...validApp, webAssembly: 'yes' }] }),
    ).toThrow(/webAssembly must be true or false/);
  });

  it('accepts an optional library flag, only with sync', () => {
    const registry = validateRegistry({
      site: validSite,
      apps: [{ ...validApp, sync: true, library: true }],
    });
    expect(registry.apps[0]?.library).toBe(true);
    expect(() =>
      validateRegistry({ site: validSite, apps: [{ ...validApp, library: true }] }),
    ).toThrow(/library needs sync: true/);
    expect(() =>
      validateRegistry({ site: validSite, apps: [{ ...validApp, sync: true, library: 'yes' }] }),
    ).toThrow(/library must be true or false/);
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

  it('lists apps in alphabetical order', () => {
    const names = listedApps.map((app) => app.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
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

  it('keeps each description to 160 characters (docs/adding-an-app.md)', () => {
    for (const { description } of [hub, ...apps]) {
      expect(description.length, description).toBeLessThanOrEqual(160);
    }
  });

  it('says in an app’s description that reminders while it’s closed leave the device (audit 3 D-5)', () => {
    // They need neither sync nor an account, so "unless you turn on sync" isn't enough.
    for (const app of apps.filter((entry) => entry.pushNotifications === true)) {
      const optIns = [...(app.sync ? ['sync'] : []), "reminders while it's closed"];
      expect(app.description, app.slug).toContain(`unless you turn on ${optIns.join(' or ')}`);
    }
    expect(hub.description).toContain('reminders while an app is closed');
  });
});
