import path from "node:path";
import { lineOf, type Violation } from "./report.ts";

/**
 * Checks that relative links in Markdown files point to files that exist, and that `#anchors`
 * match a heading in the target file, using GitHub's heading-anchor rules. External links are
 * not fetched. Only ATX headings (`# Title`) are recognised, which is the style the docs use.
 */

/** Replaces the lines of fenced code blocks with spaces, keeping offsets intact. */
function blankFences(markdown: string): string {
  let fence: string | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === undefined && marker !== undefined) {
        fence = marker;
        return " ".repeat(line.length);
      }
      if (fence !== undefined) {
        if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
          fence = undefined;
        }
        return " ".repeat(line.length);
      }
      return line;
    })
    .join("\n");
}

/** Replaces fenced code blocks and inline code with spaces, keeping offsets intact. */
export function blankCode(markdown: string): string {
  return blankFences(markdown).replaceAll(/(`+)[^`\n]*?\1/g, (code) => " ".repeat(code.length));
}

/** The anchor GitHub generates for a heading's text. */
export function githubSlug(heading: string): string {
  const text = heading
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images: keep the text
    .replaceAll(/`([^`]*)`/g, "$1") // inline code: keep the code
    .replaceAll("*", "");
  return text
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replaceAll(" ", "-");
}

/** All anchors a Markdown document defines, with GitHub's `-1`, `-2` suffixes for repeats. */
export function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  // Inline code still counts as heading text, so only fenced blocks are removed.
  const source = blankFences(markdown);
  for (const match of source.matchAll(/^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/gm)) {
    const slug = githubSlug(match[1] ?? "");
    const seen = counts.get(slug) ?? 0;
    anchors.add(seen === 0 ? slug : `${slug}-${seen}`);
    counts.set(slug, seen + 1);
  }
  return anchors;
}

export interface MarkdownLink {
  readonly target: string;
  readonly line: number;
}

const INLINE_LINK =
  /!?\[(?:[^\]\\\n]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)>?/gm;

export function extractLinks(markdown: string): MarkdownLink[] {
  const source = blankCode(markdown);
  const links: MarkdownLink[] = [];
  for (const pattern of [INLINE_LINK, REFERENCE_DEFINITION]) {
    for (const match of source.matchAll(pattern)) {
      const target = match[1];
      if (target !== undefined) {
        links.push({ target, line: lineOf(source, match.index) });
      }
    }
  }
  return links.toSorted((a, b) => a.line - b.line);
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export interface DocLinkContext {
  /** Markdown files by repo-relative path. */
  readonly markdown: ReadonlyMap<string, string>;
  /** Whether a repo-relative path exists (file or directory). */
  readonly exists: (repoPath: string) => boolean;
}

export function checkDocLinks(context: DocLinkContext): Violation[] {
  const violations: Violation[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchorsOf = (file: string, content: string): Set<string> => {
    let anchors = anchorCache.get(file);
    if (anchors === undefined) {
      anchors = headingAnchors(content);
      anchorCache.set(file, anchors);
    }
    return anchors;
  };

  for (const [file, content] of context.markdown) {
    for (const link of extractLinks(content)) {
      if (EXTERNAL.test(link.target)) {
        continue;
      }
      const hashIndex = link.target.indexOf("#");
      const rawPath = hashIndex === -1 ? link.target : link.target.slice(0, hashIndex);
      const fragment = hashIndex === -1 ? undefined : link.target.slice(hashIndex + 1);

      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(rawPath);
      } catch {
        violations.push({ file, line: link.line, message: `Malformed link "${link.target}".` });
        continue;
      }

      const targetFile =
        decodedPath === ""
          ? file
          : path.posix.normalize(path.posix.join(path.posix.dirname(file), decodedPath));
      if (decodedPath !== "" && (targetFile.startsWith("../") || !context.exists(targetFile))) {
        violations.push({
          file,
          line: link.line,
          message: `Broken link "${link.target}": ${targetFile} does not exist.`,
        });
        continue;
      }

      if (fragment !== undefined && fragment !== "" && targetFile.endsWith(".md")) {
        const targetContent = context.markdown.get(targetFile);
        if (targetContent !== undefined && !anchorsOf(targetFile, targetContent).has(fragment)) {
          violations.push({
            file,
            line: link.line,
            message: `Broken anchor "${link.target}": no heading "#${fragment}" in ${targetFile}.`,
          });
        }
      }
    }
  }
  return violations;
}
