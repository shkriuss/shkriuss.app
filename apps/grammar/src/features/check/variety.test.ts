import { describe, expect, it } from "vitest";
import { varietyOf } from "./variety.ts";

describe("varietyOf", () => {
  it("takes the variety of English of the browser's language and region", () => {
    expect(varietyOf("en-GB")).toBe("british");
    expect(varietyOf("en-IE")).toBe("british");
    expect(varietyOf("en-NZ")).toBe("british");
    expect(varietyOf("en-AU")).toBe("australian");
    expect(varietyOf("en-CA")).toBe("canadian");
    expect(varietyOf("en-IN")).toBe("indian");
    expect(varietyOf("en-US")).toBe("american");
  });

  it("starts with American English otherwise", () => {
    expect(varietyOf("en")).toBe("american");
    expect(varietyOf("en-ZA")).toBe("american");
    // Another language, even in Britain: its writers' English has no region to go by.
    expect(varietyOf("cy-GB")).toBe("american");
    expect(varietyOf("not a locale")).toBe("american");
  });
});
