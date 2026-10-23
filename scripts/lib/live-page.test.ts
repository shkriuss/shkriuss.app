import { describe, expect, it } from 'vitest';
import { livePageProblem } from './live-page.ts';

const deployed =
  '<!doctype html><html lang="en"><head><script type="module" src="/_astro/page.js"></script></head><body><a href="http://example.com/">x</a></body></html>';

describe('livePageProblem', () => {
  it('passes the page that was deployed', () => {
    expect(livePageProblem(deployed, deployed)).toBeUndefined();
  });

  it("spots Cloudflare's own scripts", () => {
    const analytics = deployed.replace(
      '</body>',
      '<script defer src="/cdn-cgi/rum.js"></script></body>',
    );
    expect(livePageProblem(analytics, deployed)).toMatch(/cdn-cgi/);
  });

  it('spots an inline script, like Rocket Loader adds', () => {
    const rocket = deployed
      .replace('type="module"', 'type="text/rocketscript"')
      .replace('</head>', '<script>loadScripts()</script></head>');
    expect(livePageProblem(rocket, deployed)).toMatch(/script that wasn’t deployed/);
  });

  it('spots any other change, like rewritten links', () => {
    const rewritten = deployed.replace('http://', 'https://');
    expect(livePageProblem(rewritten, deployed)).toMatch(/isn’t the one deployed/);
  });
});
