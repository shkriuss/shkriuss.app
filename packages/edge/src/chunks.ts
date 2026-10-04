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
