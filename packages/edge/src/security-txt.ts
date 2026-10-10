import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import { SOURCE_URL } from "./licenses.ts";

/**
 * Where every origin says how to report a security problem ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116)),
 * the hub's and each app's, because a researcher looks at the site in front of them
 * (docs/specs/hub.md §4).
 */
export const SECURITY_TXT_FILE = ".well-known/security.txt";

/** How long a `security.txt` stays valid after the commit that it was built from. */
export const SECURITY_TXT_DAYS = 180;

const DAY = 24 * 60 * 60 * 1000;

/**
 * The `security.txt` of a build from a commit of `committed`. It points to GitHub's private
 * vulnerability report, as SECURITY.md does, so that no email address is published. It
 * expires `SECURITY_TXT_DAYS` after the commit, never after the build: production rebuilds
 * the commit that staging got, maybe days later, and must match it byte for byte.
 */
export function securityTxt(committed: Date): string {
  const expires = new Date(committed.getTime() + SECURITY_TXT_DAYS * DAY);
  return [
    `Contact: ${SOURCE_URL}/security/advisories/new`,
    `Policy: ${SOURCE_URL}/security/policy`,
    "Preferred-Languages: en",
    `Expires: ${expires.toISOString()}`,
    "",
  ].join("\n");
}

/** Runs git in `directory` and gives its output. */
export type Git = (directory: string, args: readonly string[]) => Promise<string>;

const runGit: Git = async (directory, args) =>
  (await promisify(execFile)("git", [...args], { cwd: directory, encoding: "utf8" })).stdout;

/**
 * When the commit that is built was made: from `SOURCE_DATE_EPOCH`, as reproducible builds
 * set it, or else from git, as the date of the checkout's `HEAD` commit. Throws if neither
 * gives one, rather than build a file that would differ from build to build.
 */
export async function commitDate(
  directory: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  git: Git = runGit,
): Promise<Date> {
  const epoch = environment["SOURCE_DATE_EPOCH"];
  if (epoch !== undefined && epoch !== "") {
    if (!/^\d+$/v.test(epoch)) {
      throw new Error(`SOURCE_DATE_EPOCH must be whole seconds since 1970, not "${epoch}".`);
    }
    return new Date(Number(epoch) * 1000);
  }
  let seconds: string;
  try {
    seconds = (await git(directory, ["log", "-1", "--format=%ct"])).trim();
  } catch (error) {
    throw new Error(
      "security.txt expires after the date of the commit that is built: build in a git " +
        "checkout, or set SOURCE_DATE_EPOCH.",
      { cause: error },
    );
  }
  if (!/^\d+$/v.test(seconds)) {
    throw new Error(`git gave "${seconds}" as the commit's date, not seconds since 1970.`);
  }
  return new Date(Number(seconds) * 1000);
}

/** A commit's hash: 40 lowercase hexadecimal digits. */
const COMMIT_HASH = /^[0-9a-f]{40}$/v;

/**
 * The commit that is built, which `licenses.txt` names: from `GITHUB_SHA`, as GitHub Actions
 * sets it, or else from git, as the checkout's `HEAD`. Throws if neither gives one, rather than
 * build a file that would differ from build to build.
 */
export async function commitHash(
  directory: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  git: Git = runGit,
): Promise<string> {
  const given = environment["GITHUB_SHA"];
  if (given !== undefined && given !== "") {
    if (!COMMIT_HASH.test(given)) {
      throw new Error(`GITHUB_SHA must be a commit's hash, 40 hexadecimal digits, not "${given}".`);
    }
    return given;
  }
  let hash: string;
  try {
    hash = (await git(directory, ["rev-parse", "HEAD"])).trim();
  } catch (error) {
    throw new Error(
      "licenses.txt names the commit that is built: build in a git checkout, or set GITHUB_SHA.",
      { cause: error },
    );
  }
  if (!COMMIT_HASH.test(hash)) {
    throw new Error(`git gave "${hash}" as the commit, not its hash.`);
  }
  return hash;
}
