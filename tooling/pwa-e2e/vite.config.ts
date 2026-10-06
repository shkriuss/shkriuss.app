import { appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import { edge } from "@shkriuss/edge";
import { type PwaOptions, pwa } from "@shkriuss/pwa/vite";
import { defineConfig, type Plugin } from "vite";
import { BUILDS, type Build, isBuild, versionOf } from "./builds.ts";

/** How each build uses pwa(); `fix` replaces `a`, which is built before it. */
const PWA_OPTIONS: Record<Build, () => PwaOptions> = {
  a: () => ({}),
  b: () => ({}),
  broken: () => ({}),
  fix: () => ({ replaces: [versionOf("a")] }),
  removal: () => ({ remove: true }),
};

/**
 * Changes the lazily loaded chunk after edge() has written the build, as a host could: the
 * service worker then finds that it fails its hash.
 */
function changeOnHost(): Plugin {
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
        const assets = path.join(dir, "assets");
        const lazy = (await readdir(assets)).find((file) => file.startsWith("lazy-"));
        if (lazy === undefined) {
          throw new Error("The build has no lazily loaded chunk to change.");
        }
        await appendFile(path.join(assets, lazy), "\n// Changed on the host.\n");
      },
    },
  };
}

// `vite build --mode <build>` writes the build into dist/<build>.
export default defineConfig(({ mode }) => {
  if (!isBuild(mode)) {
    throw new Error(`Build with --mode and one of: ${BUILDS.join(", ")}.`);
  }
  return {
    define: { PWA_E2E_BUILD: JSON.stringify(mode) },
    build: { outDir: `dist/${mode}` },
    plugins: [pwa(PWA_OPTIONS[mode]()), edge(), ...(mode === "broken" ? [changeOnHost()] : [])],
  };
});
