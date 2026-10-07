import { describe, expect, it } from "vitest";
import { isCheckRequest, isCheckResponse, isVariety, VARIETIES } from "./protocol.ts";

describe("isCheckRequest", () => {
  it("takes a text and a variety of English, and nothing else", () => {
    expect(isCheckRequest({ text: "Hello.", variety: "british" })).toBe(true);
    expect(isCheckRequest({ text: "Hello.", variety: "scottish" })).toBe(false);
    expect(isCheckRequest({ text: 1, variety: "british" })).toBe(false);
    expect(isCheckRequest(["Hello.", "british"])).toBe(false);
    expect(isCheckRequest(null)).toBe(false);
  });
});

describe("isCheckResponse", () => {
  const mistake = {
    kind: "Spelling",
    message: "Wrong.",
    start: 0,
    end: 3,
    fixes: [{ kind: "replace", text: "the" }, { kind: "remove" }, { kind: "insert", text: "," }],
  };

  it("takes mistakes with their fixes, or a failure", () => {
    expect(isCheckResponse({ ok: true, mistakes: [mistake] })).toBe(true);
    expect(isCheckResponse({ ok: true, mistakes: [] })).toBe(true);
    expect(isCheckResponse({ ok: false })).toBe(true);
  });

  it("refuses mistakes that are not ones", () => {
    for (const wrong of [
      { ...mistake, start: -1 },
      { ...mistake, start: 4 },
      { ...mistake, end: 1.5 },
      { ...mistake, kind: 3 },
      { ...mistake, fixes: [{ kind: "replace" }] },
      { ...mistake, fixes: [{ kind: "rewrite", text: "x" }] },
      { ...mistake, fixes: "none" },
    ]) {
      expect(isCheckResponse({ ok: true, mistakes: [wrong] })).toBe(false);
    }
    expect(isCheckResponse({ ok: true })).toBe(false);
    expect(isCheckResponse({ ok: "yes", mistakes: [] })).toBe(false);
    expect(isCheckResponse(undefined)).toBe(false);
  });
});

describe("isVariety", () => {
  it("knows Harper's five varieties of English", () => {
    expect(VARIETIES.every(isVariety)).toBe(true);
    expect(isVariety("American")).toBe(false);
  });
});
