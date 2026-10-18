import { describe, expect, it } from 'vitest';
import { isBuiltWorkerUrl } from './worker-url.ts';

const ORIGIN = 'https://grammar.shkriuss.app';

describe('isBuiltWorkerUrl', () => {
  it('allows the site’s own build files', () => {
    expect(isBuiltWorkerUrl('/_astro/checker.worker-AbC123.js', ORIGIN)).toBe(true);
    expect(isBuiltWorkerUrl(`${ORIGIN}/_astro/checker.worker-AbC123.js`, ORIGIN)).toBe(true);
  });

  it('refuses anything else', () => {
    for (const url of [
      'https://example.com/_astro/x.js',
      '//example.com/_astro/x.js',
      '/sw.js',
      '/_astro/x.css',
      '/_astro/x.js?y',
      '/_astro/x.js#y',
      'blob:https://grammar.shkriuss.app/1234',
      'data:text/javascript,1',
      'javascript:alert(1)',
      'http://[',
    ]) {
      expect(isBuiltWorkerUrl(url, ORIGIN), url).toBe(false);
    }
  });
});
