import { describe, expect, it } from "vitest";
import { META_STORE, SETTINGS_STORE, isFieldName, isStoreName } from "./names.ts";

describe("field and store names (data model §2.3, §2.5)", () => {
  it.each(["a", "title", "dueDate", "item2", `a${"b".repeat(63)}`])("accepts %s", (name) => {
    expect(isFieldName(name)).toBe(true);
    expect(isStoreName(name)).toBe(true);
  });

  it.each([
    "",
    "Title",
    "2fast",
    "due_date",
    "due-date",
    "naïve",
    "__proto__",
    `a${"b".repeat(64)}`,
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
  ])("refuses %j", (name) => {
    expect(isFieldName(name)).toBe(false);
    expect(isStoreName(name)).toBe(false);
  });

  it("reserves meta for the data layer, and lets apps use settings", () => {
    expect(isFieldName(META_STORE)).toBe(true);
    expect(isStoreName(META_STORE)).toBe(false);
    expect(isStoreName(SETTINGS_STORE)).toBe(true);
  });
});
