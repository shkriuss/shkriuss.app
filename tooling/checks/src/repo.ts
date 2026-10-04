import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Absolute path of the repository root (this file lives in `tooling/checks/src`). */
export const repoRoot: string = path.resolve(import.meta.dirname, "../../..");

/**
 * Repository files as root-relative paths with forward slashes: everything tracked by git
 * plus new files that are not ignored, so checks see a change before it is committed.
 */
export function listFiles(root: string = repoRoot): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return output
    .split("\0")
    .filter((file) => file.length > 0 && existsSync(path.join(root, file)))
    .toSorted();
}

export function readText(file: string, root: string = repoRoot): string {
  return readFileSync(path.join(root, file), "utf8");
}
