import { isWorkerBundlePath } from "./worker-scripts.ts";

/** What matters about a built chunk for how the browser loads it. */
export interface ChunkInfo {
  readonly fileName: string;
  readonly isEntry: boolean;
  /** The chunks it imports statically. */
  readonly imports: readonly string[];
}

/**
 * Throws unless Safari can load every chunk (ADR 0010).
 *
 * Under `Integrity-Policy`, WebKit silently refuses a chunk that a script imports statically,
 * unless the page has already loaded it: it does not take that chunk's hash from the import
 * map. Chunks loaded with `import()` are fine. So a chunk may statically import only an entry
 * script, which the page loads itself.
 */
export function assertChunksLoadInSafari(chunks: readonly ChunkInfo[]): void {
  const entries = new Set(chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName));
  for (const chunk of chunks) {
    for (const imported of chunk.imports) {
      if (!entries.has(imported)) {
        throw new Error(
          `${chunk.fileName} imports ${imported} statically, and Safari would refuse to load it. ` +
            "Load it with import(), or import the shared code from the entry script too so that " +
            "it moves there (ADR 0010).",
        );
      }
    }
  }
}

/** A file in the build, as Vite reports it. */
export interface OutputInfo {
  readonly fileName: string;
  /** Chunks are modules of the page; Vite emits each worker bundle as an asset. */
  readonly type: "chunk" | "asset";
}

/**
 * Throws unless every worker bundle in a build can be started (ADR 0011).
 *
 * The Trusted Types policy starts only files named like a worker bundle. So the build fails for
 * a script that Vite emits as a file of its own under any other name, which the app could not
 * start, and for a module of the page that is named like a worker bundle, which the policy
 * would start.
 */
export function assertWorkerBundleNames(outputs: readonly OutputInfo[]): void {
  for (const { fileName, type } of outputs) {
    const isBundle = isWorkerBundlePath(`/${fileName}`);
    if (type === "asset" && fileName.endsWith(".js") && !isBundle) {
      throw new Error(
        `${fileName} is a script file of its own, like a worker, but not named ` +
          '"<name>.worker-<hash>.js", so the app could not start it. Name each worker module ' +
          '"<name>.worker.ts" in lowercase kebab case, and import it with "?worker&url" (ADR 0011).',
      );
    }
    if (type === "chunk" && isBundle) {
      throw new Error(
        `${fileName} is named like a worker bundle but is not one, so the app could start it as ` +
          'a worker. Import "*.worker.ts" modules only with "?worker&url" (ADR 0011).',
      );
    }
  }
}
