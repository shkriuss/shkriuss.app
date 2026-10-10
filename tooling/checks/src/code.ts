import { lineOf, type Violation } from "./report.ts";

/**
 * Code rules that lint cannot see (CLAUDE.md, security rules 2–4 and product rule 4). Oxlint
 * refuses the HTML sinks that are written as a member access (`innerHTML`, `document.write`, …),
 * `eval` and its relatives, the `style` prop, and text in JSX and in string attributes. This
 * check refuses the spellings that reach the same places another way: inline styles set from
 * code, an HTML parser, a worker started outside `@shkriuss/edge/workers`, a sink reached through
 * `Object.assign` or `Reflect.set`, and UI text inside an attribute's `{…}` expression.
 *
 * Each rule is a regular expression over the source with its comments blanked, which is enough
 * for code that Prettier formats; it is not a parser. The check reads the TypeScript sources that
 * `pnpm check` lists, except unit tests, end-to-end suites and this file, which names every
 * pattern it refuses.
 */

/** This file, which must name every pattern it refuses. */
const SELF = "tooling/checks/src/code.ts";
/** The only code that may start a worker or register the service worker (ADR 0011). */
const WORKERS_PACKAGE = "packages/edge/browser/";
/** How far past `Object.assign(` or `Reflect.set(` a sink name is looked for. */
const CALL_LIMIT = 4096;

/**
 * The attributes that people read or hear: the `restrictedAttributes` of `react/jsx-no-literals`
 * in `.oxlintrc.json`, which refuses a string in them, while this check refuses a string inside
 * their `{…}` expression.
 */
const TEXT_ATTRIBUTES = [
  "alt",
  "aria-braillelabel",
  "aria-brailleroledescription",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "description",
  "errorMessage",
  "label",
  "placeholder",
  "title",
];

interface Rule {
  /** A global pattern; every match is a violation. */
  readonly pattern: RegExp;
  readonly message: string | ((match: RegExpExecArray) => string);
  /** Applies only to `.tsx` files, where JSX lives. */
  readonly jsx?: boolean;
  /** Files where the pattern is allowed. */
  readonly allowed?: (file: string) => boolean;
}

const RULES: readonly Rule[] = [
  {
    // element.style.color = …, element.style.cssText = …, element.style = …,
    // element.style.setProperty(…)
    pattern: /\.style(?:\.[A-Za-z_$][\w$]*)?\s*=(?!=)|\.style\.setProperty\s*\(/g,
    message: "Inline styles are not allowed; use classes (CLAUDE.md, security rule 3).",
  },
  {
    pattern: /\bsetAttribute\s*\(\s*["'`]style["'`]/g,
    message: "Inline styles are not allowed; use classes (CLAUDE.md, security rule 3).",
  },
  {
    pattern: /\bDOMParser\b/g,
    message:
      "DOMParser parses HTML; render user content as text or React elements (CLAUDE.md, security rule 2).",
  },
  {
    pattern: /\bnew\s+(?:Shared)?Worker\s*\(/g,
    message:
      "Start workers only with @shkriuss/edge/workers (CLAUDE.md, security rule 4; ADR 0011).",
    allowed: (file) => file.startsWith(WORKERS_PACKAGE),
  },
  {
    pattern: /\bserviceWorker\s*\.\s*register\s*\(/g,
    message:
      "Register the service worker only with @shkriuss/edge/workers (CLAUDE.md, security rule 4; ADR 0011).",
    allowed: (file) => file.startsWith(WORKERS_PACKAGE),
  },
  {
    pattern: /\bFunction\s*\.\s*prototype\s*\.\s*constructor\b/g,
    message:
      "Function.prototype.constructor compiles code, like eval; never use it (CLAUDE.md, security rule 2).",
  },
  {
    pattern: /\b(?:window|globalThis|self)\s*\.\s*open\s*\(/g,
    message:
      "window.open() is not allowed; render a link that the user follows instead (CLAUDE.md, security rule 2).",
  },
  {
    pattern: /\bdocument\s*\.\s*title\s*=(?!=)\s*["'`]/g,
    message:
      "document.title takes its text from a message module, never a literal (ADR 0012; CLAUDE.md, product rule 4).",
  },
  {
    // aria-label={"…"}, label={`…`}, title={'…'}: a string where lint only sees an expression.
    pattern: new RegExp(`(?<![\\w-])(${TEXT_ATTRIBUTES.join("|")})\\s*=\\s*\\{\\s*["'\`]`, "g"),
    message: (match) =>
      `Text in ${match[1] ?? ""} comes from a message module, not from a string in the attribute's expression (ADR 0012; CLAUDE.md, product rule 4).`,
    jsx: true,
  },
];

/** A call that can set a property by its name, where lint sees no member access. */
const INDIRECT_SETTER = /\b(?:Object\s*\.\s*assign|Reflect\s*\.\s*set)\s*\(/g;
const HTML_SINK = /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/;
const INDIRECT_SINK_MESSAGE =
  "innerHTML, outerHTML and insertAdjacentHTML are not allowed, through Object.assign or Reflect.set either; render text or React elements (CLAUDE.md, security rule 2).";

/** The sources this check reads. */
export function isCheckedSource(file: string): boolean {
  return (
    /\.(?:[cm]?ts|tsx)$/.test(file) &&
    !/\.test\.(?:[cm]?ts|tsx)$/.test(file) &&
    !/(?:^|\/)(?:e2e|node_modules)\//.test(file) &&
    file !== SELF
  );
}

/**
 * Replaces comments with spaces, keeping offsets and line numbers, so that a comment may name
 * what the code must not. String literals are copied as they are: a sink may hide in one.
 */
export function blankComments(source: string): string {
  const out: string[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      out.push(" ".repeat(stop - index));
      index = stop;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out.push(source.slice(index, stop).replaceAll(/[^\n]/g, " "));
      index = stop;
    } else if (char === '"' || char === "'" || char === "`") {
      // A string literal, up to its closing quote, past backslash escapes. A quote that a line
      // end interrupts (an apostrophe in JSX text, say) ends there.
      let end = index + 1;
      while (end < source.length && source[end] !== char) {
        if (source[end] === "\\") {
          end += 1;
        } else if (char !== "`" && source[end] === "\n") {
          break;
        }
        end += 1;
      }
      const stop = Math.min(end + 1, source.length);
      out.push(source.slice(index, stop));
      index = stop;
    } else {
      out.push(char);
      index += 1;
    }
  }
  return out.join("");
}

/** The text of a call from its opening parenthesis to the matching one, and the rest of its line. */
function callText(code: string, open: number): string {
  let depth = 0;
  let end = Math.min(open + CALL_LIMIT, code.length);
  for (let index = open; index < end; index += 1) {
    const char = code[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  const lineEnd = code.indexOf("\n", open);
  return code.slice(open, Math.max(end, lineEnd === -1 ? code.length : lineEnd));
}

export function checkSource(file: string, source: string): Violation[] {
  const code = blankComments(source);
  const violations: Violation[] = [];
  const report = (offset: number, message: string): void => {
    violations.push({ file, line: lineOf(code, offset), message });
  };

  for (const rule of RULES) {
    if ((rule.jsx === true && !file.endsWith(".tsx")) || rule.allowed?.(file) === true) {
      continue;
    }
    for (const match of code.matchAll(rule.pattern)) {
      report(match.index, typeof rule.message === "string" ? rule.message : rule.message(match));
    }
  }
  for (const match of code.matchAll(INDIRECT_SETTER)) {
    if (HTML_SINK.test(callText(code, match.index + match[0].length - 1))) {
      report(match.index, INDIRECT_SINK_MESSAGE);
    }
  }
  return violations.toSorted((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

export function checkCode(files: readonly string[], read: (file: string) => string): Violation[] {
  return files.filter(isCheckedSource).flatMap((file) => checkSource(file, read(file)));
}
