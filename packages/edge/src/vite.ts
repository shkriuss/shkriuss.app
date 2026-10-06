import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import { assertChunksLoadInSafari, assertWorkerBundleNames } from "./chunks.ts";
import { appHost, STAGING_DOMAIN } from "./domains.ts";
import { appHeaderRules, headersFile } from "./headers-file.ts";
import type { BrowserFeature } from "./headers.ts";
import { addScriptIntegrity, cspHashSource, subresourceIntegrity } from "./integrity.ts";
import { type CollectOptions, LICENSES_FILE, collectLicenses, licensesFile } from "./licenses.ts";
import { buildManifest, formatManifest, MANIFEST_FILE } from "./manifest.ts";
import { commitDate, SECURITY_TXT_FILE, securityTxt } from "./security-txt.ts";
import { type ServiceWorkerApi, serviceWorkerApi } from "./service-worker.ts";
import { isWorkerBundlePath, isWorkerScriptPath, SERVICE_WORKER_PATH } from "./worker-scripts.ts";

/** What Rolldown tells about the modules of a chunk. */
interface ChunkModules {
  readonly modules: Readonly<Record<string, { readonly renderedLength: number }>>;
}

const STYLESHEET = /\.(?:css|scss|sass|less|styl)(?:\?|$)/;

/**
 * The modules whose code a chunk includes: those with rendered code, and stylesheets, whose code
 * goes into the CSS file instead. Modules that tree-shaking removed entirely are left out.
 */
function includedModules(chunk: ChunkModules): string[] {
  return Object.entries(chunk.modules)
    .filter(([id, module]) => module.renderedLength > 0 || STYLESHEET.test(id))
    .map(([id]) => id);
}

/** Collects the modules of every worker bundle, which Vite builds on its own. */
function workerModules(modules: Set<string>): Plugin {
  return {
    name: "shkriuss:edge:worker-modules",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") {
          for (const id of includedModules(output)) {
            modules.add(id);
          }
        }
      }
    },
  };
}

/**
 * The repository's root: the nearest directory, from `start` up, with pnpm-workspace.yaml, or
 * `start` itself for an app outside a workspace.
 */
function repositoryRoot(start: string): string {
  for (let directory = start; ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
      return directory;
    }
    if (path.dirname(directory) === directory) {
      return start;
    }
  }
}

/**
 * Vite's package.json, for the code that Vite and Rolldown generate: this package's own Vite,
 * which is the version that builds every app, since the pnpm catalog has one.
 */
const VITE = createRequire(import.meta.url).resolve("vite/package.json");

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
 * The Content-Security-Policy allows the Trusted Types policy that starts workers only if the
 * build has worker scripts: worker bundles, or a service worker at `/sw.js` (ADR 0011). Each
 * worker is built into one file, because a worker cannot check the integrity of the scripts it
 * imports.
 *
 * It works on the files as written, so the hashes match exactly the bytes that are served.
 *
 * It writes `licenses.txt` too: the license texts of every package of others whose code is in
 * the build, in the page's chunks, in its workers and in its service worker, and the legal
 * comments (`/*! … *\/`) of this repository's files that include material of others. The build
 * fails for a package without a license file and for generated code of unknown origin.
 *
 * And `/.well-known/security.txt`, which says how to report a security problem, on every
 * origin (RFC 9116). It expires 180 days after the date of the commit that is built, so that
 * every build of a commit is the same.
 *
 * With `pwa()` of `@shkriuss/pwa/vite` among the plugins, it writes the service worker,
 * `/sw.js`, after every other file, because the service worker lists their hashes.
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
  const workers = new Set<string>();
  let licenseOptions: CollectOptions | undefined;
  let serviceWorker: ServiceWorkerApi | undefined;
  return {
    name: "shkriuss:edge",
    apply: "build",
    enforce: "post",
    config() {
      return {
        build: { modulePreload: false, cssCodeSplit: false },
        worker: { format: "iife", plugins: () => [workerModules(workers)] },
      };
    },
    configResolved(config) {
      serviceWorker = serviceWorkerApi(config.plugins);
      licenseOptions = {
        root: repositoryRoot(config.root),
        packageOf: (name) =>
          path.dirname(
            name === "vite" ? VITE : createRequire(VITE).resolve(`${name}/package.json`),
          ),
      };
      if (config.base !== "/") {
        throw new Error(
          `Apps are served from the root of their own origin, so "base" must be "/", not "${config.base}".`,
        );
      }
      if (config.build.modulePreload !== false || config.build.cssCodeSplit) {
        throw new Error("Module preloading and per-chunk CSS must stay off (ADR 0010).");
      }
      if (config.worker.format !== "iife") {
        throw new Error(
          'Each worker must be built into one file, so worker.format must be "iife" (ADR 0011).',
        );
      }
    },
    buildStart() {
      workers.clear();
    },
    writeBundle: {
      order: "post",
      sequential: true,
      async handler(outputOptions, bundle) {
        const directory = outputOptions.dir;
        if (directory === undefined) {
          throw new Error("The build has no output directory to add integrity hashes to.");
        }

        const outputs = Object.values(bundle);
        assertChunksLoadInSafari(outputs.filter((output) => output.type === "chunk"));
        assertWorkerBundleNames(outputs);

        const files = Object.keys(bundle).toSorted();
        const hashes = new Map<string, string>();
        for (const file of files) {
          // Worker scripts are started, never imported, so the import map leaves them out.
          if (isWorkerScriptPath(`/${file}`)) {
            continue;
          }
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

        // Vite builds each worker on its own, and edge()'s worker plugin reports its modules.
        if (files.some((file) => isWorkerBundlePath(`/${file}`)) && workers.size === 0) {
          throw new Error("No worker build reported its modules: keep edge()'s worker.plugins.");
        }
        if (licenseOptions === undefined) {
          throw new Error("The build has no resolved configuration.");
        }
        const serviceWorkerBundle = await serviceWorker?.bundle();
        const pageModules = outputs.flatMap((output) =>
          output.type === "chunk" ? includedModules(output) : [],
        );
        const licenses = await collectLicenses(
          [...pageModules, ...workers, ...(serviceWorkerBundle?.modules ?? [])],
          licenseOptions,
        );
        await writeFile(path.join(directory, LICENSES_FILE), licensesFile(options.appId, licenses));

        // Before the service worker, which keeps every served file.
        const securityTxtPath = path.join(directory, SECURITY_TXT_FILE);
        if (existsSync(securityTxtPath)) {
          throw new Error(
            `The build already has /${SECURITY_TXT_FILE}, which edge() writes; remove the other.`,
          );
        }
        await mkdir(path.dirname(securityTxtPath), { recursive: true });
        await writeFile(securityTxtPath, securityTxt(await commitDate(licenseOptions.root)));

        // Last of the served files, because it lists the hashes of all the others.
        if (serviceWorkerBundle !== undefined) {
          const file = path.join(directory, SERVICE_WORKER_PATH);
          if (existsSync(file)) {
            throw new Error(
              `The build already has ${SERVICE_WORKER_PATH}, which pwa() writes; remove the other.`,
            );
          }
          await writeFile(file, serviceWorkerBundle.script(await buildManifest(directory)));
        }

        // After the HTML is final, so it covers every file as served, including those copied
        // from public/. It leaves out _headers, which is not served.
        const manifest = await buildManifest(directory);
        const rules = appHeaderRules({
          scriptHashes: [...scriptHashes],
          workers: [...manifest.keys()].some(isWorkerScriptPath),
          allowedFeatures: options.allowedFeatures ?? [],
          stagingHost,
        });
        await writeFile(path.join(directory, "_headers"), headersFile(rules));
        await writeFile(path.join(directory, MANIFEST_FILE), formatManifest(manifest));
      },
    },
  };
}
