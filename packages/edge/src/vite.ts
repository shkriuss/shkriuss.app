import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { appHost, STAGING_DOMAIN } from "./domains.ts";
import { appHeaderRules, headersFile } from "./headers-file.ts";
import type { BrowserFeature } from "./headers.ts";
import { addScriptIntegrity, cspHashSource, subresourceIntegrity } from "./integrity.ts";

export interface EdgeOptions {
  /** The app's permanent id, which is also its subdomain. Leave it out for the hub. */
  readonly appId?: string;
  /** Browser features the app needs (see `DENIED_FEATURES`); everything else is denied. */
  readonly allowedFeatures?: readonly BrowserFeature[];
}

/**
 * Vite plugin for every app's production build. After Vite has written the files, it hashes
 * the scripts, adds integrity attributes and the import map to the HTML, and writes the
 * `_headers` file with the matching Content-Security-Policy.
 *
 * It works on the files as written, so the hashes match exactly the bytes that are served.
 */
export function edge(options: EdgeOptions = {}): Plugin {
  const stagingHost = appHost(STAGING_DOMAIN, options.appId);
  return {
    name: "shkriuss:edge",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      if (config.base !== "/") {
        throw new Error(
          `Apps are served from the root of their own origin, so "base" must be "/", not "${config.base}".`,
        );
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

        const files = Object.keys(bundle).toSorted();
        const hashes = new Map<string, string>();
        for (const file of files) {
          if (file.endsWith(".js") || file.endsWith(".css")) {
            const bytes = await readFile(path.join(directory, file));
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
      },
    },
  };
}
