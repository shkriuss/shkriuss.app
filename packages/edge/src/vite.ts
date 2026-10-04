import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { assertChunksLoadInSafari } from "./chunks.ts";
import { appHost, STAGING_DOMAIN } from "./domains.ts";
import { appHeaderRules, headersFile } from "./headers-file.ts";
import type { BrowserFeature } from "./headers.ts";
import { addScriptIntegrity, cspHashSource, subresourceIntegrity } from "./integrity.ts";
import { buildManifest, formatManifest, MANIFEST_FILE } from "./manifest.ts";

export interface EdgeOptions {
  /** The app's permanent id, which is also its subdomain. Leave it out for the hub. */
  readonly appId?: string;
  /** Browser features the app needs (see `DENIED_FEATURES`); everything else is denied. */
  readonly allowedFeatures?: readonly BrowserFeature[];
}

/**
 * Vite plugin for every app's production build. After Vite has written the files, it hashes
 * the scripts, adds integrity attributes and the import map to the HTML, writes the
 * `_headers` file with the matching Content-Security-Policy, and publishes the SHA-256 of
 * every served file in `sha256sums.txt`.
 *
 * It works on the files as written, so the hashes match exactly the bytes that are served.
 *
 * It also keeps every chunk loadable in Safari, and every file name tied to its content
 * (ADR 0010):
 *
 * - **Only `import()` loads chunks.** Under `Integrity-Policy`, WebKit silently refuses a
 *   chunk that a script imports statically before the page has loaded it. The build fails
 *   unless every chunk imports only the entry script statically.
 * - **No module preloading.** WebKit ignores the integrity of `<link rel="modulepreload">`.
 * - **One stylesheet, so no preload lists.** Vite writes the list of files to preload for each
 *   `import()` into a chunk after it has named the chunk after its content. A list could
 *   then change while the name stays the same, and a returning visitor's cached copy, which
 *   `/assets/` keeps for a year, would fail its new integrity hash. Without module
 *   preloading and per-chunk CSS, Vite writes no such lists; the build fails if one appears.
 */
export function edge(options: EdgeOptions = {}): Plugin {
  const stagingHost = appHost(STAGING_DOMAIN, options.appId);
  return {
    name: "shkriuss:edge",
    apply: "build",
    enforce: "post",
    config() {
      return { build: { modulePreload: false, cssCodeSplit: false } };
    },
    configResolved(config) {
      if (config.base !== "/") {
        throw new Error(
          `Apps are served from the root of their own origin, so "base" must be "/", not "${config.base}".`,
        );
      }
      if (config.build.modulePreload !== false || config.build.cssCodeSplit) {
        throw new Error("Module preloading and per-chunk CSS must stay off (ADR 0010).");
      }
    },
    writeBundle: {
      order: "post",
      sequential: true,
      async handler(outputOptions, bundle) {
        const directory = outputOptions.dir;
        if (directory === undefined) {
          throw new Error("The build has no output directory to add integrity hashes to.");
        }

        assertChunksLoadInSafari(Object.values(bundle).filter((output) => output.type === "chunk"));

        const files = Object.keys(bundle).toSorted();
        const hashes = new Map<string, string>();
        for (const file of files) {
          if (file.endsWith(".js") || file.endsWith(".css")) {
            const bytes = await readFile(path.join(directory, file));
            if (file.endsWith(".js") && bytes.includes("__vite__mapDeps")) {
              throw new Error(
                `${file} lists files to preload, which Vite adds after naming the file (ADR 0010).`,
              );
            }
            hashes.set(`/${file}`, subresourceIntegrity(bytes));
          }
        }

        const scriptHashes = new Set<string>();
        for (const file of files.filter((name) => name.endsWith(".html"))) {
          const htmlPath = path.join(directory, file);
          const { html, importMap } = addScriptIntegrity(await readFile(htmlPath, "utf8"), hashes);
          await writeFile(htmlPath, html);
          scriptHashes.add(cspHashSource(importMap));
        }
        if (scriptHashes.size === 0) {
          throw new Error("The build has no HTML page to add integrity hashes to.");
        }

        const rules = appHeaderRules({
          scriptHashes: [...scriptHashes],
          allowedFeatures: options.allowedFeatures ?? [],
          stagingHost,
        });
        await writeFile(path.join(directory, "_headers"), headersFile(rules));
        // Last, so it covers every file as served, including those copied from public/.
        await writeFile(
          path.join(directory, MANIFEST_FILE),
          formatManifest(await buildManifest(directory)),
        );
      },
    },
  };
}
