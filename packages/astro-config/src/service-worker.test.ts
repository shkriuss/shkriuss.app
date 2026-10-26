import { describe, expect, it } from 'vitest';
import { precacheUrls, serviceWorkerSource } from './service-worker.ts';

/** The sites' policy now, and before a change that tightened it. */
const CSP_NOW = "default-src 'none'; script-src 'self'";
const CSP_BEFORE = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'";

describe('precacheUrls', () => {
  it('turns built files into the URLs they are served at', () => {
    expect(precacheUrls(['index.html', 'privacy/index.html', '404.html', '_astro/a.js'])).toEqual([
      '/',
      '/404',
      '/_astro/a.js',
      '/privacy/',
    ]);
  });

  it('leaves out files that are not served as-is, and on-demand downloads', () => {
    expect(
      precacheUrls([
        '_headers',
        'sw.js',
        'index.html',
        'on-demand/deep-check/manifest.json',
        'on-demand/deep-check/model.00.0123456789ab.bin',
      ]),
    ).toEqual(['/']);
  });
});

describe('serviceWorkerSource', () => {
  const source = serviceWorkerSource({ files: ['/'], version: 'abc123', csp: CSP_NOW });

  it('only deletes its own old caches, never one an app manages', () => {
    expect(source).toContain("const CACHE = 'shkriuss-abc123';");
    expect(source).toContain("key.startsWith('shkriuss-') && key !== CACHE");
  });

  it('serves any saved file, from any cache, before the network', () => {
    expect(source).toContain(
      'caches.match(request).then((cached) => (cached ? withPolicy(cached) : fetch(request)))',
    );
  });
});

// ---------- The worker running, in a pretend browser ----------

const ORIGIN = 'https://tally.shkriuss.app';
type Listener = (event: Record<string, unknown>) => void;

type Stores = Map<string, Map<string, Response>>;

/**
 * Runs the generated worker with in-memory caches and the given network. Pass
 * the same `stores` to run a newer version in the same pretend browser.
 */
function running(
  network: (url: string) => Response,
  { version = 'v1', files = ['/'], stores = new Map() as Stores, csp = CSP_NOW } = {},
) {
  const listeners = new Map<string, Listener>();
  const keyOf = (request: string | { url: string }) =>
    typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;
  const find = (
    store: Map<string, Response>,
    request: string | { url: string },
    options?: { ignoreSearch?: boolean },
  ) => {
    const wanted = new URL(keyOf(request));
    if (options?.ignoreSearch) wanted.search = '';
    for (const [key, response] of store) {
      const url = new URL(key);
      if (options?.ignoreSearch) url.search = '';
      if (url.href === wanted.href) return response.clone();
    }
    return undefined;
  };
  const caches = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        put: async (request: string | { url: string }, response: Response) =>
          void store.set(keyOf(request), response),
        add: async (url: string) => void store.set(keyOf(url), network(keyOf(url))),
        keys: async () => [...store.keys()].map((url) => ({ url })),
        match: async (request: string | { url: string }) => find(store, request),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: string | { url: string }, options?: { ignoreSearch?: boolean }) => {
      for (const store of stores.values()) {
        const found = find(store, request, options);
        if (found) return found;
      }
      return undefined;
    },
  };
  interface Shown {
    data: { url: string };
    tag?: string;
    renotify?: boolean;
  }
  const shown: { title: string; options: Shown }[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    registration: {
      showNotification: async (title: string, options: Shown) => {
        // As Chrome does.
        if (options.renotify && !options.tag) throw new TypeError('renotify needs a tag');
        shown.push({ title, options });
      },
    },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const fetch = async (request: { url: string }) => network(request.url);
  new Function('self', 'caches', 'fetch', serviceWorkerSource({ files, version, csp }))(
    self,
    caches,
    fetch,
  );
  const lifecycle = async (type: string) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
  };

  return {
    caches,
    stores,
    shown,
    /** Installs and takes over, as a new version does. */
    async start(): Promise<void> {
      await lifecycle('install');
      await lifecycle('activate');
    },
    /** Opens a page, and resolves with what the worker shows. */
    async open(path: string): Promise<Response> {
      let answer: Promise<Response> | undefined;
      const waits: Promise<unknown>[] = [];
      listeners.get('fetch')?.({
        request: { method: 'GET', url: new URL(path, ORIGIN).href, mode: 'navigate' },
        respondWith: (response: Promise<Response>) => (answer = response),
        waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      });
      const response = await (answer as Promise<Response>);
      await Promise.all(waits);
      return response;
    },
    /** Asks for a build file, as a page does. */
    async file(path: string): Promise<Response> {
      let answer: Promise<Response> | undefined;
      listeners.get('fetch')?.({
        request: { method: 'GET', url: new URL(path, ORIGIN).href, mode: 'no-cors' },
        respondWith: (response: Promise<Response>) => (answer = response),
        waitUntil: () => undefined,
      });
      return answer as Promise<Response>;
    },
    async push(message: unknown): Promise<void> {
      const waits: Promise<unknown>[] = [];
      listeners.get('push')?.({
        data: { json: () => message },
        waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      });
      await Promise.all(waits);
    },
  };
}

const page = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('the service worker', () => {
  it('shows the saved copy of a page when the server has a problem', async () => {
    let answer = page('saved');
    const worker = running(() => answer);
    await worker.start();
    answer = page('fresh');
    expect(await (await worker.open('/?utm=1')).text()).toBe('fresh');
    answer = page('Server error', 503);
    expect(await (await worker.open('/?utm=2')).text()).toBe('saved');
    // With nothing saved, the error is shown as it is.
    expect((await worker.open('/other/')).status).toBe(503);
  });

  it('shows the saved copy of a page instead of a 4xx too, which a saved page can’t be', async () => {
    // Such as Cloudflare refusing requests with too many cookies (audit 4 C-5).
    let answer = page('saved');
    const worker = running(() => answer);
    await worker.start();
    answer = page('Request Header Or Cookie Too Large', 400);
    expect(await (await worker.open('/')).text()).toBe('saved');
    answer = page('Not found', 404);
    expect((await worker.open('/missing/')).status).toBe(404);
    // A redirect is passed on as it is.
    answer = Object.defineProperty(new Response(null, { status: 200 }), 'type', {
      value: 'opaqueredirect',
    });
    expect((await worker.open('/')).type).toBe('opaqueredirect');
  });

  it('serves saved files with the site’s security policy now (audit 4 C-4)', async () => {
    // A worker's script saved under an older, looser policy, by the version before.
    const network = (csp: string) => (url: string) =>
      new Response(url, { headers: { 'Content-Security-Policy': csp } });
    const first = running(network(CSP_BEFORE), {
      version: 'v1',
      files: ['/', '/_astro/worker.js'],
      csp: CSP_BEFORE,
    });
    await first.start();
    const { stores } = first;
    // Only the headers change: the file isn't downloaded again, but served with the new policy.
    const second = running(network(CSP_NOW), {
      version: 'v2',
      files: ['/', '/_astro/worker.js'],
      stores,
    });
    await second.start();
    const saved = await second.file('/_astro/worker.js');
    expect(saved.headers.get('Content-Security-Policy')).toBe(CSP_NOW);
    expect(await saved.text()).toBe(`${ORIGIN}/_astro/worker.js`);
    // So are files an app saved itself, like Grammar's Deep check model.
    const own = await second.caches.open('deep-check');
    await own.put(`${ORIGIN}/on-demand/model.bin`, network(CSP_BEFORE)('model'));
    const model = await second.file('/on-demand/model.bin');
    expect(model.headers.get('Content-Security-Policy')).toBe(CSP_NOW);
    expect(await model.text()).toBe('model');
  });

  it('saves pages only with their own version’s files, never from the network', async () => {
    let online = true;
    let version = 'N';
    const worker = running(() => {
      if (!online) throw new TypeError('offline');
      return page(`page ${version}`);
    });
    await worker.start();
    // A newer version's page, shown online before its worker is installed…
    version = 'N+1';
    expect(await (await worker.open('/')).text()).toBe('page N+1');
    await worker.open('/on-demand/model.bin');
    // …isn't saved: offline, the page saved with this version's scripts is shown.
    online = false;
    expect(await (await worker.open('/')).text()).toBe('page N');
    expect(await worker.caches.match(`${ORIGIN}/on-demand/model.bin`)).toBeUndefined();
  });

  it('keeps the previous version’s build files for pages still open, until the next', async () => {
    const network = (url: string) =>
      new URL(url).pathname.startsWith('/_astro/') ? new Response(url) : page('');
    const first = running(network, {
      version: 'v1',
      files: ['/', '/_astro/a1.js', '/_astro/s.js'],
    });
    await first.start();
    const { stores } = first;
    const second = running(network, {
      version: 'v2',
      files: ['/', '/_astro/a2.js', '/_astro/s.js'],
      stores,
    });
    await second.start();
    expect([...stores.keys()].sort()).toEqual(['shkriuss-previous', 'shkriuss-v2']);
    // A page still open from v1 starts its worker: the file is there, offline too.
    const kept = [...(stores.get('shkriuss-previous')?.keys() ?? [])];
    expect(kept).toEqual([`${ORIGIN}/_astro/a1.js`]);
    expect(await (await second.file('/_astro/a1.js')).text()).toBe(`${ORIGIN}/_astro/a1.js`);

    const third = running(network, { version: 'v3', files: ['/', '/_astro/a3.js'], stores });
    await third.start();
    expect([...stores.keys()].sort()).toEqual(['shkriuss-previous', 'shkriuss-v3']);
    expect([...(stores.get('shkriuss-previous')?.keys() ?? [])].sort()).toEqual([
      `${ORIGIN}/_astro/a2.js`,
      `${ORIGIN}/_astro/s.js`,
    ]);
  });

  it('opens only pages on its own site from a notification', async () => {
    const worker = running(() => page(''));
    const opens = async (url: unknown) => {
      await worker.push({ title: 'Reminder', url });
      return worker.shown.at(-1)?.options.data.url;
    };
    expect(await opens('/today/?a=1#b')).toBe(`${ORIGIN}/today/?a=1#b`);
    expect(await opens('/\\example.com')).toBe('/');
    expect(await opens('//example.com/')).toBe('/');
    expect(await opens('https://example.com/')).toBe('/');
    expect(await opens(undefined)).toBe(`${ORIGIN}/`);
    // Its path starts with "//", which on its own would mean another website.
    expect(await opens('/.//example.com/x')).toBe(`${ORIGIN}//example.com/x`);
  });

  // Each repeat of a reminder has the same tag, so it replaced the last one
  // without a sound or vibration (audit 3 F1-1).
  it('rings again for a notification that replaces one with the same tag', async () => {
    const worker = running(() => page(''));
    await worker.push({ title: 'Take my pills', tag: 'pills' });
    await worker.push({ title: 'Take my pills', tag: 'pills' });
    expect(worker.shown.map(({ options }) => [options.tag, options.renotify])).toEqual([
      ['pills', true],
      ['pills', true],
    ]);
    // Without a tag, nothing to replace.
    await worker.push({ title: 'Reminder' });
    expect(worker.shown.at(-1)?.options).toMatchObject({ tag: undefined, renotify: false });
  });
});
