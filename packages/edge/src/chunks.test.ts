import { describe, expect, it } from "vitest";
import { assertChunksLoadInSafari } from "./chunks.ts";

describe("assertChunksLoadInSafari", () => {
  it("accepts chunks that import only the entry script statically", () => {
    expect(() =>
      assertChunksLoadInSafari([
        { fileName: "assets/index-a.js", isEntry: true, imports: [] },
        { fileName: "assets/lazy-b.js", isEntry: false, imports: ["assets/index-a.js"] },
      ]),
    ).not.toThrow();
  });

  it("rejects an entry script that imports another chunk statically", () => {
    expect(() =>
      assertChunksLoadInSafari([
        { fileName: "assets/index-a.js", isEntry: true, imports: ["assets/react-c.js"] },
        { fileName: "assets/react-c.js", isEntry: false, imports: [] },
      ]),
    ).toThrow(/assets\/index-a\.js imports assets\/react-c\.js statically/);
  });

  it("rejects a lazily loaded chunk that imports a shared chunk statically", () => {
    expect(() =>
      assertChunksLoadInSafari([
        { fileName: "assets/index-a.js", isEntry: true, imports: [] },
        { fileName: "assets/lazy-b.js", isEntry: false, imports: ["assets/shared-d.js"] },
        { fileName: "assets/shared-d.js", isEntry: false, imports: [] },
      ]),
    ).toThrow(/Safari would refuse/);
  });
});
