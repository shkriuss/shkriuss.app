import { describe, expect, it } from "vitest";
import { assertWebAssembly, isWebAssemblyPath } from "./webassembly.ts";

const MODULE = "/assets/add-0123abcd.wasm";
const PAGE = { fileName: "assets/index-0123abcd.js", code: "console.info(1);" };

describe("isWebAssemblyPath", () => {
  it("knows WebAssembly modules by their extension", () => {
    expect(isWebAssemblyPath(MODULE)).toBe(true);
    expect(isWebAssemblyPath("/assets/index-0123abcd.js")).toBe(false);
    expect(isWebAssemblyPath("/assets/wasm-0123abcd.js")).toBe(false);
  });
});

describe("assertWebAssembly", () => {
  it("allows nothing for an app that neither declares nor ships WebAssembly", () => {
    expect(
      assertWebAssembly({ declared: false, paths: ["/index.html"], pageScripts: [PAGE] }),
    ).toBe(false);
  });

  it("allows WebAssembly for an app that declares it and ships modules for its workers", () => {
    expect(
      assertWebAssembly({ declared: true, paths: ["/index.html", MODULE], pageScripts: [PAGE] }),
    ).toBe(true);
  });

  it("refuses modules in an app that does not declare WebAssembly", () => {
    expect(() =>
      assertWebAssembly({ declared: false, paths: [MODULE], pageScripts: [PAGE] }),
    ).toThrow(/has WebAssembly \(\/assets\/add-0123abcd\.wasm\), which only an app that declares/);
  });

  it("refuses a declaration without any module, which would allow WebAssembly for nothing", () => {
    expect(() =>
      assertWebAssembly({ declared: true, paths: ["/index.html"], pageScripts: [PAGE] }),
    ).toThrow(/declares webAssembly, but its build has no WebAssembly module/);
  });

  it("refuses a script of the page that refers to a module", () => {
    const page = {
      fileName: "assets/index-0123abcd.js",
      code: 'fetch(new URL("add-0123abcd.wasm", import.meta.url));',
    };
    expect(() =>
      assertWebAssembly({ declared: true, paths: [MODULE], pageScripts: [PAGE, page] }),
    ).toThrow(
      "assets/index-0123abcd.js refers to /assets/add-0123abcd.wasm, but only workers load WebAssembly (ADR 0014).",
    );
  });
});
