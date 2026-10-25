import { describe, expect, it } from 'vitest';
import { appOriginFor, hubOriginFor, isAppOrigin } from './origins.ts';

const url = (text: string) => new URL(text);

describe('hubOriginFor', () => {
  it('finds the hub for the real site', () => {
    expect(hubOriginFor(url('https://calendar.shkriuss.app/'))).toBe('https://shkriuss.app');
  });

  it('uses the given address when there is one (local tests)', () => {
    expect(hubOriginFor(url('http://127.0.0.1:8788/'), 'http://127.0.0.1:8787/')).toBe(
      'http://127.0.0.1:8787',
    );
  });

  it('gives up on anything else', () => {
    for (const address of [
      'http://calendar.shkriuss.app/',
      'https://calendar.example.com/',
      'https://shkriuss.app.evil.com/',
      'https://calendar.workers.dev/',
      // Pull request previews are gone (docs/adr/0019): no hub for them.
      'https://pr-12-calendar.shkriuss.workers.dev/x',
      'http://127.0.0.1:8788/',
    ]) {
      expect(hubOriginFor(url(address)), address).toBeNull();
    }
  });
});

describe('appOriginFor', () => {
  it('finds an app from the real hub', () => {
    expect(appOriginFor(url('https://shkriuss.app/account/'), 'tally')).toBe(
      'https://tally.shkriuss.app',
    );
  });

  it('gives up on anything else', () => {
    for (const address of [
      'http://shkriuss.app/',
      'http://127.0.0.1:8787/',
      'https://pr-12-calendar.shkriuss.workers.dev/',
      'https://pr-12-hub.shkriuss.workers.dev/account/',
      'https://example.com/',
    ]) {
      expect(appOriginFor(url(address), 'tally'), address).toBeNull();
    }
  });
});

describe('isAppOrigin', () => {
  const real = url('https://shkriuss.app/account/');
  const workersDev = url('https://pr-12-hub.shkriuss.workers.dev/account/');
  const local = url('http://127.0.0.1:8787/account/');

  it('accepts only the app’s own address on the real site', () => {
    expect(isAppOrigin('https://calendar.shkriuss.app', 'calendar', real)).toBe(true);
    for (const from of [
      'https://tally.shkriuss.app',
      'http://calendar.shkriuss.app',
      'https://calendar.shkriuss.app/',
      'https://calendar.shkriuss.app/x',
      'https://calendar.shkriuss.app:444',
      'https://evil.com',
      'https://calendar.shkriuss.app.evil.com',
      'http://127.0.0.1:8788',
      'https://pr-12-calendar.shkriuss.workers.dev',
      'not a url',
    ]) {
      expect(isAppOrigin(from, 'calendar', real), from).toBe(false);
    }
  });

  it('accepts no app on a workers.dev address (there are no previews: docs/adr/0019)', () => {
    for (const from of [
      'https://pr-12-calendar.shkriuss.workers.dev',
      'https://calendar.shkriuss.app',
    ]) {
      expect(isAppOrigin(from, 'calendar', workersDev), from).toBe(false);
    }
  });

  it('accepts this computer only when the hub runs on it (tests)', () => {
    expect(isAppOrigin('http://127.0.0.1:8788', 'calendar', local)).toBe(true);
    expect(isAppOrigin('https://calendar.shkriuss.app', 'calendar', local)).toBe(false);
    expect(isAppOrigin('http://127.0.0.1:8788', 'calendar', real)).toBe(false);
  });
});
