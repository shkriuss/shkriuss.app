import path from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";

/** The modules whose code is in the encryption worker's bundle, built as an app's build does. */
async function bundledModules(): Promise<string[]> {
  const result = await build({
    root: path.join(import.meta.dirname, ".."),
    configFile: false,
    logLevel: "silent",
    build: { write: false, rollupOptions: { input: "src/age.worker.ts" } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    "output" in output ? output.output : [],
  );
  return outputs.flatMap((chunk) =>
    chunk.type === "chunk"
      ? Object.entries(chunk.modules)
          .filter(([, module]) => module.renderedLength > 0)
          .map(([id]) => id)
      : [],
  );
}

describe("the encryption worker's bundle", () => {
  it("has age's code, and none of the database's, which the worker never opens", async () => {
    const modules = await bundledModules();
    expect(modules.some((id) => id.includes("/age-encryption/"))).toBe(true);
    // @shkriuss/data has no side effects ("sideEffects": false): what the worker uses of it
    // leaves out its database, and with it Dexie, which made 96 kB of the bundle's 243 kB.
    expect(modules.filter((id) => /\/dexie\/|\/data\/src\/db\.ts$/v.test(id))).toStrictEqual([]);
  }, 30_000);
});
