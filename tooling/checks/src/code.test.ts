import { describe, expect, it } from "vitest";
import { blankComments, checkCode, checkSource, isCheckedSource } from "./code.ts";

const APP = "apps/notes/src/main.ts";
const COMPONENT = "apps/notes/src/App.tsx";

/** The violations of one source as `line: message`. */
const messages = (source: string, file: string = APP): string[] =>
  checkSource(file, source).map((violation) => `${violation.line ?? 0}: ${violation.message}`);

describe("isCheckedSource", () => {
  it("reads TypeScript sources, including configuration files", () => {
    const sources = [
      "apps/notes/src/main.ts",
      "apps/notes/src/App.tsx",
      "apps/notes/app.config.ts",
      "apps/notes/vite.config.ts",
      "packages/pwa/worker/worker.ts",
      "packages/backup/src/test/worker.ts",
      "tooling/app-template/src/main.tsx",
      "tooling/checks/src/html.ts",
    ];
    expect(sources.filter(isCheckedSource)).toStrictEqual(sources);
  });

  it("leaves out unit tests, end-to-end suites, node_modules, other files and itself", () => {
    const others = [
      "apps/notes/src/main.test.ts",
      "packages/ui/src/Button.test.tsx",
      "apps/notes/e2e/app.spec.ts",
      "tooling/app-template/e2e/app.spec.ts",
      "node_modules/example/index.ts",
      "apps/notes/node_modules/example/index.ts",
      "tooling/checks/src/code.ts",
      "apps/notes/index.html",
      "apps/notes/src/styles.css",
      "README.md",
    ];
    expect(others.filter(isCheckedSource)).toStrictEqual([]);
  });
});

describe("blankComments", () => {
  it("blanks line and block comments, keeping line numbers", () => {
    expect(blankComments("a // b\n/* c\nd */ e")).toBe("a     \n    \n     e");
  });

  it("keeps strings, where a comment marker or a sink may be", () => {
    const source = 'const url = "https://example.com"; const key = \'inner\' + "HTML"; // x';
    expect(blankComments(source)).toBe(
      'const url = "https://example.com"; const key = \'inner\' + "HTML";     ',
    );
    expect(blankComments("`a // ${b} /* c */`")).toBe("`a // ${b} /* c */`");
  });

  it("ends a quote that a line end interrupts, as in JSX text", () => {
    expect(blankComments("<p>Don't</p>\n// comment")).toBe("<p>Don't</p>\n          ");
  });
});

describe("checkSource", () => {
  it("refuses inline styles set from code", () => {
    expect(messages('el.style.color = "red";')).toStrictEqual([
      "1: Inline styles are not allowed; use classes (CLAUDE.md, security rule 3).",
    ]);
    expect(messages("el.style.cssText = css;")).toHaveLength(1);
    expect(messages('el.style = "color: red";')).toHaveLength(1);
    expect(messages('el.style.setProperty("--x", "1");')).toHaveLength(1);
    expect(messages('el.setAttribute("style", "color: red");')).toHaveLength(1);
    expect(messages("el.setAttribute('style', css);")).toHaveLength(1);
    expect(messages("el.setAttribute( `style`, css);")).toHaveLength(1);
  });

  it("accepts reading styles, and other attributes and names", () => {
    expect(
      messages(
        [
          'if (el.style.color === "red") {}',
          "const { style } = props;",
          'const styles = { color: "red" };',
          "options.styles = styles;",
          'el.setAttribute("data-style", "x");',
          'el.classList.add("styled");',
        ].join("\n"),
      ),
    ).toStrictEqual([]);
  });

  it("refuses DOMParser", () => {
    expect(
      messages('const doc = new DOMParser().parseFromString(html, "text/html");'),
    ).toStrictEqual([
      "1: DOMParser parses HTML; render user content as text or React elements (CLAUDE.md, security rule 2).",
    ]);
    expect(messages("const parser = new DOMParserLike();\nconst dom = parse(text);")).toStrictEqual(
      [],
    );
  });

  it("refuses workers started outside @shkriuss/edge/workers", () => {
    expect(messages("const worker = new Worker(url, { type: 'module' });")).toStrictEqual([
      "1: Start workers only with @shkriuss/edge/workers (CLAUDE.md, security rule 4; ADR 0011).",
    ]);
    expect(messages("const worker = new SharedWorker(url);")).toHaveLength(1);
    expect(messages('await navigator.serviceWorker.register("/sw.js");')).toStrictEqual([
      "1: Register the service worker only with @shkriuss/edge/workers (CLAUDE.md, security rule 4; ADR 0011).",
    ]);
    expect(messages("await window.navigator.serviceWorker.register(url);")).toHaveLength(1);
    expect(
      messages(
        "const worker = new Worker(url);\nawait navigator.serviceWorker.register(url);",
        "packages/edge/browser/workers.ts",
      ),
    ).toStrictEqual([]);
    expect(
      messages(
        [
          'import { startWorker } from "@shkriuss/edge/workers";',
          "const worker = startWorker(url);",
          "const pool = new WorkerPool(url);",
          "const registration = await navigator.serviceWorker.ready;",
        ].join("\n"),
      ),
    ).toStrictEqual([]);
  });

  it("refuses Function.prototype.constructor", () => {
    expect(messages('const f = Function.prototype.constructor("return 1");')).toStrictEqual([
      "1: Function.prototype.constructor compiles code, like eval; never use it (CLAUDE.md, security rule 2).",
    ]);
    expect(
      messages("const f = Function.prototype.call;\nconst n = x.constructor.name;"),
    ).toStrictEqual([]);
  });

  it("refuses window.open", () => {
    expect(messages("window.open(url);")).toStrictEqual([
      "1: window.open() is not allowed; render a link that the user follows instead (CLAUDE.md, security rule 2).",
    ]);
    expect(messages("globalThis.open(url);")).toHaveLength(1);
    expect(messages("self.open(url);")).toHaveLength(1);
    expect(
      messages(
        "await open(file);\ndialog.open();\nconst { opener } = window;\nwindow.opener = null;",
      ),
    ).toStrictEqual([]);
  });

  it("refuses a literal document.title", () => {
    expect(messages('document.title = "Notes";')).toStrictEqual([
      "1: document.title takes its text from a message module, never a literal (ADR 0012; CLAUDE.md, product rule 4).",
    ]);
    expect(messages("document.title = `Notes`;")).toHaveLength(1);
    expect(messages("document.title = 'Notes';")).toHaveLength(1);
    expect(
      messages('document.title = m.pageTitle(name);\nif (document.title === "x") {}'),
    ).toStrictEqual([]);
  });

  it("refuses HTML sinks reached through Object.assign or Reflect.set", () => {
    expect(messages("Object.assign(el, { innerHTML: html });")).toStrictEqual([
      "1: innerHTML, outerHTML and insertAdjacentHTML are not allowed, through Object.assign or Reflect.set either; render text or React elements (CLAUDE.md, security rule 2).",
    ]);
    expect(
      messages("Object.assign(el, {\n  className: 'x',\n  innerHTML: html,\n});"),
    ).toStrictEqual([
      "1: innerHTML, outerHTML and insertAdjacentHTML are not allowed, through Object.assign or Reflect.set either; render text or React elements (CLAUDE.md, security rule 2).",
    ]);
    expect(messages('Reflect.set(el, "innerHTML", html);')).toHaveLength(1);
    expect(messages("Reflect.set(el, 'outerHTML', html);")).toHaveLength(1);
    expect(messages("Reflect.set(el, `insertAdjacentHTML`, fn);")).toHaveLength(1);
    expect(
      messages(
        [
          "Object.assign(el, { textContent: text });",
          'Reflect.set(globalThis, "self", scope);',
          "return Object.assign(Component, { preload });",
          "Object.assign(el, props); // innerHTML would be refused",
        ].join("\n"),
      ),
    ).toStrictEqual([]);
  });

  it("refuses UI text in an attribute's expression, in .tsx files", () => {
    expect(messages('<Button aria-label={"Close"} />', COMPONENT)).toStrictEqual([
      "1: Text in aria-label comes from a message module, not from a string in the attribute's expression (ADR 0012; CLAUDE.md, product rule 4).",
    ]);
    expect(messages("<TextField label={`Name`} />", COMPONENT)).toHaveLength(1);
    expect(messages("<img alt={'Logo'} />", COMPONENT)).toHaveLength(1);
    expect(messages("<TextField label={ `${first} ${last}` } />", COMPONENT)).toHaveLength(1);
    expect(
      messages(
        [
          "<TextField",
          '  description={"Your name"}',
          '  errorMessage={"Required"}',
          '  placeholder={"Jane"}',
          '  title={"Name"}',
          '  aria-description={"The name shown to others"}',
          "/>",
        ].join("\n"),
        COMPONENT,
      ).map((message) => message.split(":")[0]),
    ).toStrictEqual(["2", "3", "4", "5", "6"]);
  });

  it("accepts attributes that take messages, class names, ids and links", () => {
    expect(
      messages(
        [
          "<Button aria-label={m.close()} />",
          "<TextField label={label} description={cond ? m.a() : m.b()} />",
          '<img alt="" src={icon} />',
          '<div className={"p-4"} id={"main"} data-label={"x"} />',
          '<Link href={"/about"} />',
          "<p title={m.title()}>{m.text()}</p>",
        ].join("\n"),
        COMPONENT,
      ),
    ).toStrictEqual([]);
  });

  it("leaves attribute spellings in .ts files to lint, where they are strings", () => {
    expect(messages('const props = `aria-label={"Close"}`;')).toStrictEqual([]);
  });

  it("ignores comments and reports the line of each violation", () => {
    const source = [
      '// el.style.color = "red";',
      "/* new DOMParser()",
      '   window.open(url); */ el.style.color = "red";',
      '{/* aria-label={"x"} */}',
      "Reflect.set(el, 'innerHTML', html);",
    ].join("\n");
    expect(checkSource(COMPONENT, source)).toStrictEqual([
      {
        file: COMPONENT,
        line: 3,
        message: "Inline styles are not allowed; use classes (CLAUDE.md, security rule 3).",
      },
      {
        file: COMPONENT,
        line: 5,
        message:
          "innerHTML, outerHTML and insertAdjacentHTML are not allowed, through Object.assign or Reflect.set either; render text or React elements (CLAUDE.md, security rule 2).",
      },
    ]);
  });
});

describe("checkCode", () => {
  it("checks the sources among the repository's files", () => {
    const files: Record<string, string> = {
      "apps/notes/src/main.ts": "window.open(url);",
      "apps/notes/src/main.test.ts": "window.open(url);",
      "apps/notes/e2e/app.spec.ts": "window.open(url);",
      "packages/edge/browser/workers.ts": "new Worker(url);",
      "docs/example.md": "window.open(url);",
    };
    expect(checkCode(Object.keys(files), (file) => files[file] ?? "")).toStrictEqual([
      {
        file: "apps/notes/src/main.ts",
        line: 1,
        message:
          "window.open() is not allowed; render a link that the user follows instead (CLAUDE.md, security rule 2).",
      },
    ]);
  });
});
