/**
 * The test server: every build of the test app (builds.ts) at one origin, as a host serves
 * each version of an app in turn. Run it with `node server.ts <port>`.
 *
 * - **Each build** is served by a `wrangler dev` of its own, Cloudflare's asset server with the
 *   build's `_headers` file, as in production.
 * - **In front of them,** a proxy sends each request to the build that the `build` cookie names,
 *   unchanged. Requests of a service worker carry the cookie too, so a browser context sees one
 *   build at a time, and tests in other contexts run in parallel.
 * - **Offline:** with the cookie `build=offline`, the proxy closes the connection instead, so
 *   every request that reaches the network fails, as offline.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { BUILDS, isBuild } from "./builds.ts";

const port = Number(process.argv[2] ?? "4175");
const directory = import.meta.dirname;
const COOKIE = /(?:^|;\s*)build=([a-z]+)(?:;|$)/;

/** Each build's own server, on the ports after the proxy's. */
const backends = new Map(BUILDS.map((build, index) => [build, port + 10 + index]));

const children: ChildProcess[] = [];
function stop(): void {
  for (const child of children) {
    child.kill();
  }
}
process.on("exit", stop);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    process.exit(0);
  });
}

for (const [build, backend] of backends) {
  // The configuration of an app (apps/*/wrangler.json), for this build's directory. Each in a
  // directory of its own, where Wrangler keeps its state: servers that shared one would lock
  // each other's databases as they start.
  const config = path.join(directory, ".wrangler", "pwa-e2e", build, "wrangler.json");
  await mkdir(path.dirname(config), { recursive: true });
  await writeFile(
    config,
    JSON.stringify({
      name: `shkriuss-pwa-e2e-${build}`,
      compatibility_date: "2026-10-01",
      assets: {
        directory: path.join(directory, "dist", build),
        not_found_handling: "single-page-application",
      },
      workers_dev: false,
      preview_urls: false,
      send_metrics: false,
    }),
  );
  children.push(
    spawn(
      path.join(directory, "node_modules", ".bin", "wrangler"),
      // Each server needs a devtools port of its own too, as in @shkriuss/config/playwright.
      [
        "dev",
        "-c",
        config,
        "--port",
        `${backend}`,
        "--ip",
        "127.0.0.1",
        "--inspector-port",
        `${backend + 5100}`,
      ],
      {
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    ),
  );
}

/** Waits until a build's server answers. */
async function ready(backend: number): Promise<void> {
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${backend}/`)).ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }
}
await Promise.all([...backends.values()].map(ready));

http
  .createServer((request, response) => {
    const build = COOKIE.exec(request.headers.cookie ?? "")?.[1] ?? BUILDS[0];
    if (build === "offline") {
      request.socket.destroy();
      return;
    }
    const backend = isBuild(build) ? backends.get(build) : undefined;
    if (backend === undefined) {
      response.writeHead(400).end(`There is no build named ${build}.`);
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: backend,
        method: request.method,
        path: request.url,
        headers: request.headers,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
        answer.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.destroy();
    });
    request.pipe(upstream);
  })
  .listen(port, "127.0.0.1");
console.info(`Every build of the test app is served at http://127.0.0.1:${port}/.`);
