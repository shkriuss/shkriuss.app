/**
 * The code that connects an app to the account (connect.ts) loads only when
 * "Turn on sync" is pressed. When it can't be loaded (a page left open from
 * before an update, whose files are gone), trying again never helps:
 * "Turn on sync" says to reload instead (audit 6 S40).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.doMock('./connect.ts', () => {
    throw new TypeError('Failed to fetch dynamically imported module');
  });
  const nothing = () => 0;
  vi.stubGlobal('window', {
    setTimeout: nothing,
    clearTimeout: nothing,
    setInterval: nothing,
    addEventListener: nothing,
  });
  vi.stubGlobal('document', { addEventListener: nothing, visibilityState: 'visible' });
  vi.stubGlobal('location', {
    hash: '',
    pathname: '/',
    search: '',
    origin: 'https://tally.shkriuss.app',
    assign: nothing,
  });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: nothing, removeItem: nothing });
  vi.stubGlobal('fetch', async () => Response.json({ origin: 'https://shkriuss.app', now: 1 }));
});

afterEach(() => {
  vi.doUnmock('./connect.ts');
  vi.unstubAllGlobals();
});

it('“Turn on sync” says the page is out of date when its code can’t be loaded', async () => {
  const { connectProblem, createSync } = await import('./client.ts');
  const sync = createSync({ app: 'tally', stores: [], onChange: () => undefined });
  const failure = await sync.connect().then(
    () => null,
    (error: unknown) => error,
  );
  expect(connectProblem(failure)).toBe('outdated');
});
