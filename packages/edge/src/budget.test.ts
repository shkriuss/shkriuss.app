import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertFirstPageBudget,
  FIRST_PAGE_BUDGETS,
  firstPageScripts,
  gzippedSize,
  kilobytes,
} from "./budget.ts";
import type { ChunkInfo } from "./chunks.ts";

/** An entry script that imports a chunk statically, which imports the entry back, and a chunk that it loads later. */
const CHUNKS: readonly ChunkInfo[] = [
  { fileName: "assets/index.js", isEntry: true, imports: ["assets/shared.js"] },
  { fileName: "assets/shared.js", isEntry: false, imports: ["assets/index.js"] },
  { fileName: "assets/lazy.js", isEntry: false, imports: ["assets/index.js"] },
];

describe("FIRST_PAGE_BUDGETS", () => {
  it("are ADR 0018's: 180 kB for an app with data, 150 kB for the hub and apps without", () => {
    expect(FIRST_PAGE_BUDGETS).toStrictEqual({ withData: 180_000, withoutData: 150_000 });
  });
});

describe("firstPageScripts", () => {
  it("has the page's scripts and what they import statically, once each, but not what it loads later", () => {
    expect(firstPageScripts(["assets/index.js"], CHUNKS)).toStrictEqual([
      "assets/index.js",
      "assets/shared.js",
    ]);
  });

  it("has a script of the page that is no chunk of the build, as one from public/", () => {
    expect(firstPageScripts(["legacy.js", "assets/lazy.js"], CHUNKS)).toStrictEqual([
      "assets/index.js",
      "assets/lazy.js",
      "assets/shared.js",
      "legacy.js",
    ]);
  });
});

describe("gzippedSize", () => {
  it("is the size gzip gives at level 9", () => {
    const bytes = new TextEncoder().encode("the first page's JavaScript ".repeat(100));
    expect(gzippedSize(bytes)).toBe(gzipSync(bytes, { level: 9 }).byteLength);
    expect(gzippedSize(bytes)).toBeLessThan(bytes.byteLength / 10);
  });
});

describe("kilobytes", () => {
  it("writes bytes in kilobytes of 1,000, with one decimal", () => {
    expect(kilobytes(176_912)).toBe("176.9 kB");
    expect(kilobytes(150_000)).toBe("150.0 kB");
    expect(kilobytes(0)).toBe("0.0 kB");
  });
});

describe("assertFirstPageBudget", () => {
  let directory = "";
  /** Each file's size, gzipped. */
  const sizes = new Map<string, number>();

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "shkriuss-budget-"));
    await mkdir(path.join(directory, "assets"));
    // Random bytes, which gzip cannot shrink.
    for (const [file, length] of [
      ["assets/index.js", 3000],
      ["assets/shared.js", 1000],
      ["assets/lazy.js", 50_000],
    ] as const) {
      const bytes = randomBytes(length);
      await writeFile(path.join(directory, file), bytes);
      sizes.set(file, gzippedSize(bytes));
    }
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("returns what each page loads before it runs, gzipped, within the budget", async () => {
    const loads = (sizes.get("assets/index.js") ?? 0) + (sizes.get("assets/shared.js") ?? 0);
    const pages = new Map([["index.html", ["assets/index.js"]]]);
    await expect(assertFirstPageBudget(directory, pages, CHUNKS, loads)).resolves.toStrictEqual(
      new Map([["index.html", loads]]),
    );
  });

  it("names each script and its size when a page loads more than the budget", async () => {
    const index = sizes.get("assets/index.js") ?? 0;
    const shared = sizes.get("assets/shared.js") ?? 0;
    const pages = new Map([["index.html", ["assets/index.js"]]]);
    await expect(
      assertFirstPageBudget(directory, pages, CHUNKS, index + shared - 1),
    ).rejects.toThrow(
      `index.html loads ${kilobytes(index + shared)} of JavaScript, gzipped, more than its budget of ` +
        `${kilobytes(index + shared - 1)} (ADR 0018): assets/index.js has ${kilobytes(index)}, ` +
        `assets/shared.js has ${kilobytes(shared)}. Load what its first screen does not need with import().`,
    );
  });
});
