import { describe, expect, it } from "vitest";
import {
  ACTIVATE_MESSAGE,
  isActivateMessage,
  isVersionId,
  STATE_CACHE,
  versionCache,
} from "./protocol.ts";

describe("isVersionId (§2.2)", () => {
  it("accepts 16 lowercase hexadecimal digits", () => {
    expect(isVersionId("0123456789abcdef")).toBe(true);
  });

  it.each([
    ["15 digits", "0123456789abcde"],
    ["17 digits", "0123456789abcdef0"],
    ["uppercase", "0123456789ABCDEF"],
    ["a letter beyond f", "0123456789abcdeg"],
    ["surrounding text", " 0123456789abcdef"],
    ["a number", 1234567890123456],
    ["nothing", undefined],
  ])("refuses %s", (_case, value) => {
    expect(isVersionId(value)).toBe(false);
  });
});

describe("cache names (§4, §5)", () => {
  it("names a version's cache after its id, next to the state", () => {
    expect(versionCache("0123456789abcdef")).toBe("pwa-0123456789abcdef");
    expect(STATE_CACHE).toBe("pwa-state");
  });
});

describe("isActivateMessage (§10)", () => {
  it("accepts the activate message", () => {
    expect(isActivateMessage(ACTIVATE_MESSAGE)).toBe(true);
    expect(isActivateMessage(JSON.parse('{"type":"activate"}'))).toBe(true);
  });

  it.each([
    ["another type", { type: "skip-waiting" }],
    ["more keys", { type: "activate", version: "0123456789abcdef" }],
    ["no type", { kind: "activate" }],
    ["a string", "activate"],
    ["an array", ["activate"]],
    ["null", null],
  ])("refuses %s", (_case, data) => {
    expect(isActivateMessage(data)).toBe(false);
  });
});
