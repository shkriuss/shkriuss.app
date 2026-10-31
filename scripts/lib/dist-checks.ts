/**
 * Checks on built HTML (dist/), used by scripts/check-dist.ts:
 *
 * 1. CSP safety: our Content Security Policy blocks inline scripts, inline
 *    styles and inline event handlers, so built pages must not contain any.
 * 2. Size budgets: each page's HTML, CSS and JavaScript (gzipped) must stay
 *    under a limit, so sites stay fast on slow phones and networks. The JS
 *    includes the files a page's scripts import before running.
 * 3. File sizes: Cloudflare serves files of up to 25 MiB each, so bigger
 *    ones (like a downloadable model) must be split into parts.
 * 4. Spacing: a word running into a link ("run by<a"), which happens when a
 *    line of text in an .astro file ends just before a link on the next
 *    line. Write `{' '}` at the end of that line.
 * 5. JavaScript syntax the oldest browser supported reads: every built
 *    script must read as ES2022, all that Safari 16.4 has (audit 4 J-3).
 *    Only the syntax: a newer function called in it isn't seen.
 * 6. Other websites: a page that loads anything from another website (a
 *    script, a style, an image, a frame, or a preconnect or dns-prefetch
 *    hint) tells that website about every visit. The CSP doesn't cover the
 *    hints, and the browser tests see only requests a page makes, so this
 *    reads the page: no address starting with http://, https:// or // in
 *    anything that loads. Plain links (<a href>) are fine (audit 5 Z-4).
 * 7. The offline copy: the service worker saves every file in dist/ outside
 *    on-demand/ on the first visit, so all of them together have a budget.
 */
import { gzipSync } from 'node:zlib';
import { parse } from 'acorn';

export interface Budget {
  /** Gzipped bytes. */
  html: number;
  css: number;
  js: number;
}

/**
 * Per-page limits. Raise them only with a good reason (see docs/adr). JS
 * counts every file a page's scripts import before they run (like the shared
 * sync client), which wasn't counted before 35 KB replaced 25 KB (ADR 0007).
 * What loads later with import() isn't counted: a part that opens rarely,
 * like a form, can load that way (docs/quality.md, audit 4 J-6).
 */
export const DEFAULT_BUDGET: Budget = {
  html: 20_000,
  css: 15_000,
  js: 35_000,
};

/** An attribute's value as the browser reads it: character references decoded. */
const decoded = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(
      /&(colon|tab|newline|amp);/gi,
      (_, name: string) =>
        ({ colon: ':', tab: '\t', newline: '\n', amp: '&' })[name.toLowerCase()] ?? '',
    );

interface StartTag {
  /** In lower case. */
  name: string;
  /** [name in lower case, value], in order. */
  attributes: [string, string][];
  /** The tag as written. */
  text: string;
}

/**
 * The start tags in the HTML, read the way browsers read them: attributes
 * by name, quoted or not, with spaces around "=" (so `data-src=` isn't
 * `src=`, and `onerror ="…"` is a handler: audit 3 C-5). Comments are
 * skipped, and so is the text of a script or style element.
 */
function startTags(html: string): StartTag[] {
  const lower = html.toLowerCase();
  const tags: StartTag[] = [];
  const isSpace = (at: number) => /\s/.test(html.charAt(at));
  let at = html.indexOf('<');
  while (at !== -1) {
    if (html.startsWith('<!--', at)) {
      const end = html.indexOf('-->', at + 4);
      at = end === -1 ? -1 : html.indexOf('<', end + 3);
      continue;
    }
    const opening = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(at, at + 100));
    if (!opening) {
      at = html.indexOf('<', at + 1);
      continue;
    }
    const name = (opening[1] ?? '').toLowerCase();
    let i = at + opening[0].length;
    const attributes: [string, string][] = [];
    for (;;) {
      while (i < html.length && (isSpace(i) || html[i] === '/')) i += 1;
      if (i >= html.length || html[i] === '>') break;
      const start = i;
      // A name runs to a space, "/", ">" or "=" (an "=" first belongs to it).
      i += 1;
      while (i < html.length && !/[\s/>=]/.test(html.charAt(i))) i += 1;
      const key = lower.slice(start, i);
      while (i < html.length && isSpace(i)) i += 1;
      let value = '';
      if (html[i] === '=') {
        i += 1;
        while (i < html.length && isSpace(i)) i += 1;
        const quote = html.charAt(i);
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, i + 1);
          value = html.slice(i + 1, end === -1 ? html.length : end);
          i = end === -1 ? html.length : end + 1;
        } else {
          const from = i;
          while (i < html.length && !isSpace(i) && html[i] !== '>') i += 1;
          value = html.slice(from, i);
        }
      }
      attributes.push([key, decoded(value)]);
    }
    tags.push({ name, attributes, text: html.slice(at, i + 1) });
    // What's inside a script or style element isn't HTML.
    at =
      name === 'script' || name === 'style' ? lower.indexOf(`</${name}`, i) : html.indexOf('<', i);
  }
  return tags;
}

/** Attributes whose value a browser follows as an address. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data']);

/**
 * A "javascript:" address as browsers read it: control characters and
 * spaces before it, and tabs and line breaks in it, don't count.
 */
function isScriptUrl(value: string): boolean {
  const address = value.replace(/[\t\n\r]/g, '');
  let start = 0;
  while (start < address.length && address.charCodeAt(start) <= 0x20) start += 1;
  return /^javascript:/i.test(address.slice(start));
}

/** Elements that load from an address, and the attributes that hold it (audit 5 Z-4). */
const LOADS_FROM: Record<string, readonly string[]> = {
  link: ['href', 'imagesrcset'],
  script: ['src'],
  img: ['src', 'srcset'],
  iframe: ['src'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
  embed: ['src'],
  object: ['data'],
  track: ['src'],
};

/** Kinds of <link> the browser doesn't load: the address is only information. */
const LINK_NOT_LOADED = new Set([
  'alternate',
  'author',
  'bookmark',
  'canonical',
  'help',
  'license',
  'me',
  'next',
  'prev',
  'privacy-policy',
  'search',
  'tag',
  'terms-of-service',
]);

/** The addresses in an attribute: one, or each candidate of a srcset ("a.png 1x, b.png 2x"). */
function addressesIn(key: string, value: string): string[] {
  if (!key.endsWith('srcset')) return [value];
  return value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0] ?? '');
}

/** Whether an address is another website's: "http://…", "https://…" or "//…", as browsers read it. */
function isOtherWebsite(value: string): boolean {
  const address = value.replace(/[\t\n\r]/g, '');
  let start = 0;
  while (start < address.length && address.charCodeAt(start) <= 0x20) start += 1;
  return /^(?:https?:)?\/\//i.test(address.slice(start));
}

/** Returns a description of every CSP problem in the HTML (empty when clean). */
export function cspProblems(html: string): string[] {
  const problems: string[] = [];
  for (const { name, attributes, text } of startTags(html)) {
    const valueOf = (key: string) => attributes.find(([attribute]) => attribute === key)?.[1];
    if (name === 'script') {
      const isData = /^application\/(?:ld\+)?json$/i.test((valueOf('type') ?? '').trim());
      if (valueOf('src') === undefined && !isData) problems.push(`inline ${text.slice(0, 60)}`);
    }
    if (name === 'style') problems.push('inline <style> element');
    for (const [key, value] of attributes) {
      if (key === 'style') problems.push(`style="" attribute in ${text.slice(0, 60)}…`);
      if (/^on[a-z]+$/.test(key)) problems.push(`inline event handler ${key}=`);
      if (URL_ATTRIBUTES.has(key) && isScriptUrl(value)) problems.push(`javascript: in ${key}=`);
    }
    const loads = LOADS_FROM[name];
    if (!loads) continue;
    const kinds = (valueOf('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const onlyInformation =
      name === 'link' && kinds.length > 0 && kinds.every((kind) => LINK_NOT_LOADED.has(kind));
    if (onlyInformation) continue;
    const shown = name === 'link' ? `<link rel="${kinds.join(' ')}">` : `<${name}>`;
    for (const [key, value] of attributes) {
      if (!loads.includes(key)) continue;
      for (const address of addressesIn(key, value)) {
        if (isOtherWebsite(address)) {
          problems.push(`${shown} loads from another website: ${address.slice(0, 80)}`);
        }
      }
    }
  }
  return problems;
}

/** Local CSS and JS files a page loads (paths starting with "/"). */
export function pageAssets(html: string): { css: string[]; js: string[] } {
  const css = [...html.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi)]
    .map((match) => /href=["']?([^"'\s>]+)/i.exec(match[0])?.[1])
    .filter((href): href is string => Boolean(href?.startsWith('/')));
  const js = [...html.matchAll(/<script\b[^>]*\ssrc=["']?([^"'\s>]+)/gi)]
    .map((match) => match[1])
    .filter((src): src is string => Boolean(src?.startsWith('/')));
  return { css, js };
}

/**
 * Files a script imports before it runs ("./x.js" in `import … from`,
 * `import "…"` and `export … from`), as paths from the site's root, given
 * the script's own path. Imports run later (`import("…")`, like a worker or
 * Grammar's checker) aren't included: they're not part of opening the page.
 */
export function staticImports(script: string, path: string): string[] {
  const found = new Set<string>();
  for (const match of script.matchAll(
    /\b(?:import|export)\s*(?:[^'"();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g,
  )) {
    const specifier = match[1];
    if (specifier) found.add(new URL(specifier, `https://site${path}`).pathname);
  }
  return [...found];
}

/** A page's scripts and every file they import before running, each once. */
export function scriptsLoaded(
  entries: readonly string[],
  read: (path: string) => string,
): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (seen.has(path)) continue;
    seen.add(path);
    queue.push(...staticImports(read(path), path));
  }
  return [...seen];
}

export function gzipSize(content: string | Uint8Array): number {
  return gzipSync(content, { level: 9 }).byteLength;
}

export interface PageSizes {
  html: number;
  css: number;
  js: number;
}

export function budgetProblems(sizes: PageSizes, budget: Budget = DEFAULT_BUDGET): string[] {
  return (['html', 'css', 'js'] as const)
    .filter((kind) => sizes[kind] > budget[kind])
    .map(
      (kind) => `${kind.toUpperCase()} is ${sizes[kind]} bytes gzipped (budget ${budget[kind]})`,
    );
}

/** Cloudflare's limit for one static file (Workers static assets). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function fileSizeProblems(files: readonly { path: string; bytes: number }[]): string[] {
  return files
    .filter((file) => file.bytes > MAX_FILE_BYTES)
    .map(
      (file) =>
        `${file.path} is ${file.bytes} bytes: Cloudflare serves files up to ${MAX_FILE_BYTES} bytes (split it into parts)`,
    );
}

/**
 * The most an offline copy may be: every file in dist/ outside on-demand/,
 * which the service worker saves on the first visit (audit 5 Z-4). Grammar's
 * is about 21 MB (its checker's WebAssembly); the others are under 1 MB.
 */
export const MAX_PRECACHE_BYTES = 30_000_000;

/** What the service worker saves: everything but the on-demand downloads. */
export function precacheBytes(files: readonly { path: string; bytes: number }[]): number {
  return files
    .filter((file) => !file.path.replace(/\\/g, '/').startsWith('on-demand/'))
    .reduce((total, file) => total + file.bytes, 0);
}

export function precacheProblems(
  files: readonly { path: string; bytes: number }[],
  budget = MAX_PRECACHE_BYTES,
): string[] {
  const bytes = precacheBytes(files);
  return bytes > budget
    ? [
        `the offline copy is ${bytes} bytes (budget ${budget}): every file outside on-demand/ is saved on the first visit`,
      ]
    : [];
}

/** Words that run into a link, or out of one: "run by<a …>", "</a>and". */
export function spacingProblems(html: string): string[] {
  const shown = (index: number) =>
    html.slice(Math.max(0, index - 30), index + 30).replace(/\s+/g, ' ');
  return [
    ...[...html.matchAll(/[\p{L}\p{N}]<a\s/gu)].map(
      (match) => `no space before a link: …${shown(match.index + 1)}…`,
    ),
    ...[...html.matchAll(/<\/a>[\p{L}\p{N}]/gu)].map(
      (match) => `no space after a link: …${shown(match.index + 4)}…`,
    ),
  ];
}

/**
 * The newest JavaScript every supported browser runs: Safari 16.4 has all of
 * ES2022, and not ES2024's regular expression "v" flag (CLAUDE.md,
 * "Browsers"). Astro ships scripts as they're written, its own and the
 * packages' they use, so newer syntax anywhere stops the whole script there.
 * The type check holds the apps' own code to ES2022 (tsconfig.base.json),
 * functions included; this sees what the build put out, packages' code
 * included, but only its syntax: `Object.groupBy(…)` reads as ES2022.
 */
export const NEWEST_JAVASCRIPT = 2022;

/** Why a built script's syntax is too new for the oldest browser supported, or null if it isn't. */
export function syntaxProblem(code: string): string | null {
  let problem: unknown = null;
  // A module, or else a classic script (like a service worker can be).
  for (const sourceType of ['module', 'script'] as const) {
    try {
      parse(code, { ecmaVersion: NEWEST_JAVASCRIPT, sourceType });
      return null;
    } catch (error) {
      problem ??= error;
    }
  }
  const reason = problem instanceof Error ? problem.message : String(problem);
  return `isn't ES${NEWEST_JAVASCRIPT}, so Safari 16.4 can't run it (${reason})`;
}
