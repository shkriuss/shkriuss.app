import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkAgainstLive, type Fetch } from "./live.ts";
import { MANIFEST_FILE } from "./manifest.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

/** Serves `handler` on a free local port and returns the server's origin. */
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The test server has no port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

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

interface Origin {
  readonly fetch: Fetch;
  /** The URLs requested. */
  readonly urls: string[];
  /** The responses given, to check that every body was read or cancelled. */
  readonly responses: Response[];
}

function serving(status: number, type: string, body: string): Origin {
  const urls: string[] = [];
  const responses: Response[] = [];
  return {
    urls,
    responses,
    fetch: (url) => {
      urls.push(url);
      const response = new Response(body, { status, headers: { "content-type": type } });
      responses.push(response);
      return Promise.resolve(response);
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
    ["answers 404", 404, "text/plain"],
    ["answers with the single-page fallback", 200, "text/html; charset=utf-8"],
  ])("skips the comparison when the origin has no manifest: it %s", async (_, status, type) => {
    const live = serving(status, type, "<!doctype html>");
    const build = await buildWith(`${A}  /assets/x.js\n`);
    expect(await checkAgainstLive(build, "https://shkriuss.app", live.fetch)).toEqual({
      compared: false,
      replaced: [],
    });
    // An unread body would keep the connection open.
    expect(live.responses.map((response) => response.bodyUsed)).toEqual([true]);
  });

  it.each([
    ["an outage", 503, "text/html"],
    ["a challenge page", 403, "text/html; charset=UTF-8"],
    ["a file that is not text", 200, "application/octet-stream"],
  ])("fails on %s, rather than skip the check", async (_, status, type) => {
    const live = serving(status, type, "");
    const build = await buildWith(`${A}  /assets/x.js\n`);
    await expect(checkAgainstLive(build, "https://shkriuss.app", live.fetch)).rejects.toThrow(
      `https://shkriuss.app/sha256sums.txt answered with status ${status} and content type "${type}"`,
    );
    expect(live.responses.map((response) => response.bodyUsed)).toEqual([true]);
  });

  it("does not follow a redirect: the origin must serve its manifest itself", async () => {
    const origin = await listen((_, response) => {
      response.writeHead(301, { location: "https://example.com/sha256sums.txt" }).end();
    });
    const build = await buildWith(`${A}  /assets/x.js\n`);
    await expect(checkAgainstLive(build, origin)).rejects.toThrow(
      `${origin}/sha256sums.txt answered with status 301`,
    );
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
