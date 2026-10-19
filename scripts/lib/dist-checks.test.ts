import { describe, expect, it } from 'vitest';
import {
  budgetProblems,
  cspProblems,
  fileSizeProblems,
  gzipSize,
  MAX_FILE_BYTES,
  pageAssets,
  spacingProblems,
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
  });
});

describe('pageAssets', () => {
  it('lists local CSS and JS only', () => {
    const html = `<link rel="stylesheet" href="/_astro/a.css"><link rel="icon" href="/favicon.svg">
      <script src="/_astro/b.js"></script><script src="https://example.com/x.js"></script>`;
    expect(pageAssets(html)).toEqual({ css: ['/_astro/a.css'], js: ['/_astro/b.js'] });
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
