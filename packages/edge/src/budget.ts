import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { ChunkInfo } from "./chunks.ts";

/** The budgets of the first page's JavaScript, gzipped, in bytes (ADR 0018). */
export const FIRST_PAGE_BUDGETS = {
  /** An app that keeps data, with the code of `@shkriuss/data` and `@shkriuss/backup`. */
  withData: 180_000,
  /** The hub, and an app without data. */
  withoutData: 150_000,
} as const;

/**
 * The scripts that a page loads before it runs, by file name: `scripts`, those that its HTML
 * loads, and every chunk that they import statically. Chunks that the page loads later with
 * `import()`, and workers, are not among them.
 */
export function firstPageScripts(
  scripts: readonly string[],
  chunks: readonly ChunkInfo[],
): string[] {
  const imports = new Map(chunks.map((chunk) => [chunk.fileName, chunk.imports]));
  const found = new Set<string>();
  const visit = (file: string): void => {
    if (found.has(file)) {
      return;
    }
    found.add(file);
    for (const imported of imports.get(file) ?? []) {
      visit(imported);
    }
  };
  for (const script of scripts) {
    visit(script);
  }
  return [...found].toSorted();
}

/** The size of `bytes` gzipped at level 9, as ADR 0018 measures the budgets. */
export function gzippedSize(bytes: Uint8Array): number {
  return gzipSync(bytes, { level: 9 }).byteLength;
}

/** `bytes` in kilobytes of 1,000 bytes, with one decimal: "176.9 kB". */
export function kilobytes(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

/**
 * Measures the JavaScript that each page of the build in `directory` loads before it runs
 * (`firstPageScripts`), gzipped, and throws if a page loads more than `budget` bytes of it.
 * `pages` has the scripts that each page's HTML loads, by their file names. Returns what each
 * page loads, in bytes.
 */
export async function assertFirstPageBudget(
  directory: string,
  pages: ReadonlyMap<string, readonly string[]>,
  chunks: readonly ChunkInfo[],
  budget: number,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  for (const [page, scripts] of pages) {
    const sizes = new Map<string, number>();
    for (const file of firstPageScripts(scripts, chunks)) {
      sizes.set(file, gzippedSize(await readFile(path.join(directory, file))));
    }
    const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    if (total > budget) {
      const files = [...sizes].map(([file, size]) => `${file} has ${kilobytes(size)}`);
      throw new Error(
        `${page} loads ${kilobytes(total)} of JavaScript, gzipped, more than its budget of ` +
          `${kilobytes(budget)} (ADR 0018): ${files.join(", ")}. Load what its first screen ` +
          "does not need with import().",
      );
    }
    totals.set(page, total);
  }
  return totals;
}
