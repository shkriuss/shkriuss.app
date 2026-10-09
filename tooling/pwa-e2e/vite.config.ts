import { appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import { edge } from "@shkriuss/edge";
import { type PwaOptions, pwa } from "@shkriuss/pwa/vite";
import { defineConfig, type Plugin } from "vite";
import { BUILDS, type Build, FIRST_USE, isBuild, versionOf } from "./builds.ts";

/** How each build uses pwa(); `fix` replaces `a`, which is built before it. */
const PWA_OPTIONS: Record<Build, () => PwaOptions> = {
  a: () => ({}),
  b: () => ({}),
  broken: () => ({}),
  fix: () => ({ replaces: [versionOf("a")] }),
  removal: () => ({ remove: true }),
  tampered: () => ({}),
};

/**
 * Writes the two files that every build keeps on first use, as large files that not every use of
 * an app needs: one the same in every build, one that names its build.
 */
function firstUseFiles(build: Build): Plugin {
  return {
    name: "pwa-e2e:first-use-files",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: `first-use/same${FIRST_USE}`,
        source: "the same in every build",
      });
      this.emitFile({
        type: "asset",
        fileName: `first-use/build${FIRST_USE}`,
        source: `first use of ${build}`,
      });
    },
  };
}

/**
 * Changes the file of `directory` whose name starts with `name` after edge() has written the
 * build, as a host could: the service worker then finds that it fails its hash.
 */
function changeOnHost(directory: string, name: string): Plugin {
  return {
    name: "pwa-e2e:change-on-host",
    apply: "build",
    enforce: "post",
    writeBundle: {
      order: "post",
      sequential: true,
      async handler({ dir }) {
        if (dir === undefined) {
          throw new Error("The build has no output directory.");
        }
        const files = path.join(dir, directory);
        const file = (await readdir(files)).find((entry) => entry.startsWith(name));
        if (file === undefined) {
          throw new Error(`The build has no ${directory}/${name}… to change.`);
        }
        await appendFile(path.join(files, file), "\n// Changed on the host.\n");
      },
    },
  };
}

/** What the host changes in a build, after the build. */
const CHANGES: Partial<Record<Build, Plugin>> = {
  broken: changeOnHost("assets", "lazy-"),
  tampered: changeOnHost("first-use", `build${FIRST_USE}`),
};

// `vite build --mode <build>` writes the build into dist/<build>.
export default defineConfig(({ mode }) => {
  if (!isBuild(mode)) {
    throw new Error(`Build with --mode and one of: ${BUILDS.join(", ")}.`);
  }
  const change = CHANGES[mode];
  return {
    define: { PWA_E2E_BUILD: JSON.stringify(mode) },
    build: { outDir: `dist/${mode}` },
    plugins: [
      pwa({ ...PWA_OPTIONS[mode](), keepOnFirstUse: [FIRST_USE] }),
      firstUseFiles(mode),
      edge(),
      ...(change === undefined ? [] : [change]),
    ],
  };
});
