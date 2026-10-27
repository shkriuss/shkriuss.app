import { describe, expect, it } from 'vitest';
import {
  budgetProblems,
  DEFAULT_BUDGET,
  cspProblems,
  fileSizeProblems,
  gzipSize,
  MAX_FILE_BYTES,
  MAX_PRECACHE_BYTES,
  pageAssets,
  precacheBytes,
  precacheProblems,
  scriptsLoaded,
  spacingProblems,
  staticImports,
  syntaxProblem,
} from './dist-checks.ts';

describe('cspProblems', () => {
  it('accepts external scripts and stylesheets', () => {
    const html = `<head><script src="/_astro/a.js"></script><script type="module" src="/_astro/b.js"></script>
      <link rel="stylesheet" href="/_astro/c.css"><script type="application/ld+json">{}</script></head>`;
    expect(cspProblems(html)).toEqual([]);
  });

  it('finds inline scripts, styles, style attributes and event handlers', () => {
    const html = `<script>alert(1)</script><style>p{}</style><p style="color:red">x</p>
      <button onclick="go()">go</button><a href="javascript:void 0">x</a>`;
    const problems = cspProblems(html);
    expect(problems).toHaveLength(5);
    expect(problems.join('\n')).toMatch(/inline <script>/);
    expect(problems.join('\n')).toMatch(/<style>/);
    expect(problems.join('\n')).toMatch(/style=""/);
    expect(problems.join('\n')).toMatch(/onclick=/);
    expect(problems.join('\n')).toMatch(/javascript:/);
  });

  it('does not confuse data-style or text with real problems', () => {
    expect(cspProblems('<p data-style="x">Write style="..." in CSS</p>')).toEqual([]);
    expect(
      cspProblems('<p title="a onclick=go() style=x">x</p><!-- <script>x</script> -->'),
    ).toEqual([]);
  });

  it('reads attributes as browsers do, so the usual tricks are caught (audit 3 C-5)', () => {
    const tricks = [
      '<script data-src="x">alert(1)</script>',
      '<script data-type="application/json">alert(1)</script>',
      '<p style=color:red>x</p>',
      '<img src="/a.png" onerror ="alert(1)">',
      '<img src="/a.png" / onerror=alert(1)>',
      '<form action="javascript:alert(1)"></form>',
      '<iframe src=" java\tscript:alert(1)"></iframe>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<button formaction="JavaScript&colon;alert(1)">x</button>',
      '<SCRIPT>alert(1)</SCRIPT>',
    ];
    for (const html of tricks) expect(cspProblems(html), html).toHaveLength(1);
    // A script's own text isn't read as tags.
    expect(cspProblems('<script src="/a.js">"<a href=javascript:x>"</script>')).toEqual([]);
  });

  it('refuses anything a page loads from another website, hints included (audit 5 Z-4)', () => {
    const loads = [
      '<link rel="preconnect" href="https://fonts.example">',
      '<link rel="dns-prefetch" href="//cdn.example">',
      '<link rel="preload" as="script" href="https://cdn.example/x.js">',
      '<link rel="stylesheet" href="HTTPS://cdn.example/x.css">',
      '<link rel="icon" href=" https://cdn.example/i.png">',
      '<link rel="alternate stylesheet" href="https://cdn.example/alt.css">',
      '<link href="https://cdn.example/x.css">',
      '<script src="https://cdn.example/x.js"></script>',
      '<img src="/a.png" srcset="https://cdn.example/a.png 2x">',
      '<img src="//cdn.example/a.png">',
      '<iframe src="https://other.example"></iframe>',
      '<source srcset="/a.webp 1x, https://cdn.example/a.webp 2x">',
      '<video poster="https://cdn.example/p.jpg"></video>',
      '<audio src="https://cdn.example/a.mp3"></audio>',
      '<object data="https://other.example/x.pdf"></object>',
      '<embed src="http://other.example/x.swf">',
    ];
    for (const html of loads) expect(cspProblems(html), html).toHaveLength(1);
    expect(cspProblems(loads[0] ?? '')).toEqual([
      '<link rel="preconnect"> loads from another website: https://fonts.example',
    ]);
    expect(cspProblems(loads[7] ?? '')).toEqual([
      '<script> loads from another website: https://cdn.example/x.js',
    ]);
  });

  it('allows plain links, canonical links and the site’s own files', () => {
    const fine = [
      '<a href="https://github.com/shkriuss/shkriuss.app">GitHub</a>',
      '<link rel="canonical" href="https://tally.shkriuss.app/">',
      '<link rel="stylesheet" href="/_astro/a.css">',
      '<link rel="icon" href="/favicon.svg">',
      '<link rel="manifest" href="/manifest.webmanifest">',
      '<img src="data:image/png;base64,AAAA" alt="">',
      '<img src="/a.png" srcset="/a.png 1x, /a@2x.png 2x" alt="">',
      '<script type="module" src="/_astro/b.js"></script>',
      '<form action="/api/x"></form>',
      '<p data-src="https://example.com">https://example.com</p>',
    ];
    for (const html of fine) expect(cspProblems(html), html).toEqual([]);
  });
});

describe('the offline copy (audit 5 Z-4)', () => {
  it('counts every file outside on-demand/, against 30 MB', () => {
    const files = [
      { path: 'index.html', bytes: 10 },
      { path: '_astro/a.js', bytes: 20 },
      { path: 'on-demand/deep-check/model-01.bin', bytes: MAX_FILE_BYTES },
    ];
    expect(precacheBytes(files)).toBe(30);
    expect(precacheProblems(files)).toEqual([]);
    expect(precacheProblems(files, 29)).toEqual([
      'the offline copy is 30 bytes (budget 29): every file outside on-demand/ is saved on the first visit',
    ]);
    // Grammar's is about 21 MB; change docs/quality.md too.
    expect(MAX_PRECACHE_BYTES).toBe(30_000_000);
  });
});

describe('pageAssets', () => {
  it('lists local CSS and JS only', () => {
    const html = `<link rel="stylesheet" href="/_astro/a.css"><link rel="icon" href="/favicon.svg">
      <script src="/_astro/b.js"></script><script src="https://example.com/x.js"></script>`;
    expect(pageAssets(html)).toEqual({ css: ['/_astro/a.css'], js: ['/_astro/b.js'] });
  });
});

describe('scripts a page loads', () => {
  it('finds the files a script imports before it runs, not those it starts later', () => {
    const script =
      'import{a as b}from"./client.D4.js";import"./side.js";export{c}from"../x/y.js";' +
      'const w=import("./later.js");new Worker(new URL("./worker.js",import.meta.url));';
    expect(staticImports(script, '/_astro/page.js')).toEqual([
      '/_astro/client.D4.js',
      '/_astro/side.js',
      '/x/y.js',
    ]);
  });

  it('counts each file once, following imports of imports', () => {
    const files: Record<string, string> = {
      '/_astro/a.js': 'import"./shared.js";',
      '/_astro/b.js': 'import{x}from"./shared.js";',
      '/_astro/shared.js': 'import"./deep.js";',
      '/_astro/deep.js': 'export const d=1;',
    };
    expect(scriptsLoaded(['/_astro/a.js', '/_astro/b.js'], (path) => files[path] ?? '')).toEqual([
      '/_astro/a.js',
      '/_astro/b.js',
      '/_astro/shared.js',
      '/_astro/deep.js',
    ]);
  });
});

describe('budgets', () => {
  it('reports what is over budget', () => {
    expect(budgetProblems({ html: 10, css: 10, js: 10 }, { html: 20, css: 20, js: 5 })).toEqual([
      'JS is 10 bytes gzipped (budget 5)',
    ]);
  });

  it('measures gzipped size', () => {
    expect(gzipSize('a'.repeat(10_000))).toBeLessThan(100);
  });
});

describe('fileSizeProblems', () => {
  it('reports files Cloudflare would refuse to serve', () => {
    expect(
      fileSizeProblems([
        { path: 'index.html', bytes: 1000 },
        { path: 'on-demand/part.bin', bytes: MAX_FILE_BYTES },
        { path: 'big.bin', bytes: MAX_FILE_BYTES + 1 },
      ]),
    ).toEqual([
      `big.bin is ${MAX_FILE_BYTES + 1} bytes: Cloudflare serves files up to ${MAX_FILE_BYTES} bytes (split it into parts)`,
    ]);
  });
});

describe('spacingProblems', () => {
  it('finds words that run into or out of a link', () => {
    const problems = spacingProblems('<p>run by<a href="/x">ONNX</a>and more</p>');
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^no space before a link: …<p>run by<a href/);
    expect(problems[1]).toMatch(/^no space after a link:/);
  });

  it('accepts links with spaces or punctuation around them', () => {
    expect(
      spacingProblems(
        '<p>run by <a href="/x">ONNX</a>. (<a href="/y">More</a>)</p><li><a href="/">Home</a></li>',
      ),
    ).toEqual([]);
  });
});

describe('the size budgets (audit 3 J-4)', () => {
  it('are the ones docs/quality.md gives: 20/15/35 KB gzipped', () => {
    // Raise one only with a reason in an ADR (docs/adr/0007), and change quality.md too.
    expect(DEFAULT_BUDGET).toEqual({ html: 20_000, css: 15_000, js: 35_000 });
  });
});

describe('syntaxProblem (audit 4 J-3)', () => {
  it('accepts the JavaScript Safari 16.4 reads (ES2022)', () => {
    const modern = `
      class Counter { static #count = 0; static { Counter.#count = 1; } has(o) { return #count in o; } }
      const value = await Promise.resolve(globalThis.x?.y ?? 1);
      let total = 0; total ||= value; total ??= 2;
      export const last = [1, 2, 3].at(-1) + 1_000;
    `;
    expect(syntaxProblem(modern)).toBeNull();
    // A classic script too, like a service worker can be.
    expect(syntaxProblem('with (Math) { self.answer = max(1, 2); }')).toBeNull();
  });

  it('refuses what’s newer, which stops the whole script there', () => {
    for (const newer of [
      // ES2024: a regular expression's "v" flag.
      'const letters = /[\\p{L}--[a-z]]/v;',
      // ES2025: import attributes.
      "import data from './data.json' with { type: 'json' };",
      // Explicit resource management.
      'export function f() { using file = open(); return file; }',
    ]) {
      expect(syntaxProblem(newer), newer).toMatch(/^isn't ES2022, so Safari 16.4 can't run it/);
    }
    expect(syntaxProblem('const x = ;')).toMatch(/Unexpected token/);
  });
});
