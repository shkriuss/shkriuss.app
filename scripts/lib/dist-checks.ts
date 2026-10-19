/**
 * Checks on built HTML (dist/), used by scripts/check-dist.ts:
 *
 * 1. CSP safety: our Content Security Policy blocks inline scripts, inline
 *    styles and inline event handlers, so built pages must not contain any.
 * 2. Size budgets: each page's HTML, CSS and JavaScript (gzipped) must stay
 *    under a limit, so sites stay fast on slow phones and networks.
 * 3. File sizes: Cloudflare serves files of up to 25 MiB each, so bigger
 *    ones (like a downloadable model) must be split into parts.
 * 4. Spacing: a word running into a link ("run by<a"), which happens when a
 *    line of text in an .astro file ends just before a link on the next
 *    line. Write `{' '}` at the end of that line.
 */
import { gzipSync } from 'node:zlib';

export interface Budget {
  /** Gzipped bytes. */
  html: number;
  css: number;
  js: number;
}

/** Per-page limits. Raise them only with a good reason (see docs/adr). */
export const DEFAULT_BUDGET: Budget = {
  html: 20_000,
  css: 15_000,
  js: 25_000,
};

/** Returns a description of every CSP problem in the HTML (empty when clean). */
export function cspProblems(html: string): string[] {
  const problems: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attributes = match[1] ?? '';
    const isData = /\btype=["']?application\/(?:ld\+)?json/i.test(attributes);
    if (!/\bsrc=/i.test(attributes) && !isData) {
      problems.push(`inline <script${attributes}>`);
    }
  }
  if (/<style\b/i.test(html)) problems.push('inline <style> element');
  for (const match of html.matchAll(/<[a-z][\w-]*\b[^>]*\sstyle=["'][^"']*["']/gi)) {
    problems.push(`style="" attribute in ${match[0].slice(0, 60)}…`);
  }
  for (const match of html.matchAll(/<[a-z][\w-]*\b[^>]*\s(on[a-z]+)=/gi)) {
    problems.push(`inline event handler ${match[1]}=`);
  }
  if (/\bhref=["']?\s*javascript:/i.test(html)) problems.push('javascript: link');
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
