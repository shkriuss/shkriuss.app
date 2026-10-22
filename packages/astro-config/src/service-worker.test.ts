import { describe, expect, it } from 'vitest';
import { precacheUrls, serviceWorkerSource } from './service-worker.ts';

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
  const source = serviceWorkerSource({ files: ['/'], version: 'abc123' });

  it('only deletes its own old caches, never one an app manages', () => {
    expect(source).toContain("const CACHE = 'shkriuss-abc123';");
    expect(source).toContain("key.startsWith('shkriuss-') && key !== CACHE");
  });

  it('serves any saved file, from any cache, before the network', () => {
    expect(source).toContain('caches.match(request).then((cached) => cached || fetch(request))');
  });
});

// ---------- The worker running, in a pretend browser ----------

const ORIGIN = 'https://tally.shkriuss.app';
type Listener = (event: Record<string, unknown>) => void;

/** Runs the generated worker with in-memory caches and the given network. */
function running(network: (url: string) => Response) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (request: string | { url: string }) =>
    typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;
  const caches = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        put: async (request: string | { url: string }, response: Response) =>
          void store.set(keyOf(request), response),
        add: async () => undefined,
      };
    },
    match: async (request: string | { url: string }, options?: { ignoreSearch?: boolean }) => {
      const wanted = new URL(keyOf(request));
      if (options?.ignoreSearch) wanted.search = '';
      for (const store of stores.values()) {
        for (const [key, response] of store) {
          const url = new URL(key);
          if (options?.ignoreSearch) url.search = '';
          if (url.href === wanted.href) return response.clone();
        }
      }
      return undefined;
    },
  };
  const shown: { title: string; options: { data: { url: string } } }[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    registration: {
      showNotification: async (title: string, options: { data: { url: string } }) =>
        void shown.push({ title, options }),
    },
  };
  const fetch = async (request: { url: string }) => network(request.url);
  new Function('self', 'caches', 'fetch', serviceWorkerSource({ files: ['/'], version: 'v1' }))(
    self,
    caches,
    fetch,
  );

  return {
    caches,
    shown,
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
    let answer = page('fresh');
    const worker = running(() => answer);
    expect(await (await worker.open('/')).text()).toBe('fresh');
    answer = page('Server error', 503);
    expect(await (await worker.open('/')).text()).toBe('fresh');
    // With nothing saved, the error is shown as it is.
    expect((await worker.open('/other/')).status).toBe(503);
  });

  it('saves one copy per page, whatever its query string, and only pages', async () => {
    const worker = running((url) =>
      url.includes('/on-demand/')
        ? new Response('model', { headers: { 'content-type': 'application/octet-stream' } })
        : page(url),
    );
    await worker.open('/?utm=1');
    await worker.open('/?utm=2');
    expect(await (await worker.caches.match(`${ORIGIN}/`))?.text()).toBe(`${ORIGIN}/?utm=2`);
    expect(await worker.caches.match(`${ORIGIN}/?utm=1`)).toBeUndefined();
    await worker.open('/on-demand/model.bin');
    expect(await worker.caches.match(`${ORIGIN}/on-demand/model.bin`)).toBeUndefined();
  });

  it('opens only pages on its own site from a notification', async () => {
    const worker = running(() => page(''));
    const opens = async (url: unknown) => {
      await worker.push({ title: 'Reminder', url });
      return worker.shown.at(-1)?.options.data.url;
    };
    expect(await opens('/today/?a=1#b')).toBe('/today/?a=1#b');
    expect(await opens('/\\example.com')).toBe('/');
    expect(await opens('//example.com/')).toBe('/');
    expect(await opens('https://example.com/')).toBe('/');
    expect(await opens(undefined)).toBe('/');
  });
});
