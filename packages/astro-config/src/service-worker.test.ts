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
