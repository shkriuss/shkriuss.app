import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkAgainstLive, type Fetch } from "./live.ts";
import { MANIFEST_FILE } from "./manifest.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** What `fetch` throws when the host has no DNS record. */
const unknownHost: Fetch = () =>
  Promise.reject(
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND shkriuss.app"), { code: "ENOTFOUND" }),
    }),
  );

const timeout: Fetch = () =>
  Promise.reject(new TypeError("fetch failed", { cause: new Error("timeout") }));

async function buildWith(manifest: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "shkriuss-live-"));
  roots.push(root);
  await writeFile(path.join(root, MANIFEST_FILE), manifest);
  return root;
}

function serving(status: number, type: string, body: string): { fetch: Fetch; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: (url) => {
      urls.push(url);
      return Promise.resolve(new Response(body, { status, headers: { "content-type": type } }));
    },
  };
}

describe("checkAgainstLive", () => {
  it("reads the live manifest from the origin's root", async () => {
    const live = serving(200, "text/plain; charset=utf-8", `${A}  /assets/x.js\n`);
    await checkAgainstLive(
      await buildWith(`${A}  /assets/x.js\n`),
      "https://shkriuss.app",
      live.fetch,
    );
    expect(live.urls).toEqual(["https://shkriuss.app/sha256sums.txt"]);
  });

  it("passes when every shared asset keeps its content", async () => {
    const live = serving(200, "text/plain", `${A}  /assets/x.js\n${A}  /index.html\n`);
    const build = await buildWith(`${A}  /assets/x.js\n${B}  /index.html\n${B}  /assets/y.js\n`);
    expect(await checkAgainstLive(build, "https://shkriuss.app", live.fetch)).toEqual({
      compared: true,
      replaced: [],
    });
  });

  it("reports assets that would change content under the same name", async () => {
    const live = serving(200, "text/plain", `${A}  /assets/x.js\n`);
    const build = await buildWith(`${B}  /assets/x.js\n`);
    expect(await checkAgainstLive(build, "https://shkriuss.app", live.fetch)).toEqual({
      compared: true,
      replaced: ["/assets/x.js"],
    });
  });

  it.each([
    ["the origin has no deployment yet", 404, "text/plain"],
    ["the single-page fallback answers instead", 200, "text/html; charset=utf-8"],
  ])("skips the comparison when %s", async (_, status, type) => {
    const live = serving(status, type, "<!doctype html>");
    const build = await buildWith(`${A}  /assets/x.js\n`);
    expect(await checkAgainstLive(build, "https://shkriuss.app", live.fetch)).toEqual({
      compared: false,
      replaced: [],
    });
  });

  it("skips the comparison when the host has no DNS record yet", async () => {
    const build = await buildWith(`${A}  /assets/x.js\n`);
    expect(await checkAgainstLive(build, "https://shkriuss.app", unknownHost)).toEqual({
      compared: false,
      replaced: [],
    });
  });

  it("fails on any other network error, rather than skip the check", async () => {
    const build = await buildWith(`${A}  /assets/x.js\n`);
    await expect(checkAgainstLive(build, "https://shkriuss.app", timeout)).rejects.toThrow(
      /fetch failed/,
    );
  });
});
