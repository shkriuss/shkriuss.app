import { describe, expect, it } from "vitest";
import { assertChunksLoadInSafari, assertWorkerBundleNames } from "./chunks.ts";

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

describe("assertWorkerBundleNames", () => {
  it("accepts worker bundles, which Vite emits as assets, and the page's other files", () => {
    expect(() =>
      assertWorkerBundleNames([
        { fileName: "assets/index-AbC_12-z.js", type: "chunk" },
        { fileName: "sw.js", type: "chunk" },
        { fileName: "assets/age.worker-Df7253_1.js", type: "asset" },
        { fileName: "assets/ping.worker-00000000.js", type: "asset" },
        { fileName: "assets/index-AbC_12-z.css", type: "asset" },
        { fileName: "assets/age.worker-Df7253_1.js.map", type: "asset" },
        { fileName: "index.html", type: "asset" },
      ]),
    ).not.toThrow();
  });

  it.each(["assets/ping-Df7253_1.js", "assets/Ping.worker-Df7253_1.js", "assets/lazy-Df7253_1.js"])(
    "fails for the script asset %s, which the policy would not start",
    (fileName) => {
      expect(() => assertWorkerBundleNames([{ fileName, type: "asset" }])).toThrow(
        /not named "<name>\.worker-<hash>\.js"/,
      );
    },
  );

  it("fails for a chunk of the page that is named like a worker bundle", () => {
    expect(() =>
      assertWorkerBundleNames([{ fileName: "assets/ping.worker-Df7253_1.js", type: "chunk" }]),
    ).toThrow(/named like a worker bundle but is not one/);
  });
});
