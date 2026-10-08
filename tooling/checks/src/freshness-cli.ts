/**
 * Checks what Dependabot does not update, against the npm registry and the release schedule of
 * Node.js; run by a weekly job of CI (`.github/workflows/freshness.yml`), never by `pnpm check`,
 * which works offline:
 *
 *   node tooling/checks/src/freshness-cli.ts
 *
 * It fails when a newer pnpm of the same major version has been out for pnpm's release age, or
 * when the version of Node.js that CI uses reaches its end of life within six months.
 */
import process from "node:process";
import { newerPnpm, nodeEndsSoon, nodeMajor, pinnedPnpm } from "./freshness.ts";
import { readText } from "./repo.ts";

/** About six months: time enough to move to the next version of Node.js, with an ADR. */
const NODE_WARNING_DAYS = 183;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}.`);
  }
  return response.json();
}

/** The registry's date of each release of pnpm, and `created` and `modified`. */
async function pnpmDates(): Promise<Record<string, string>> {
  const document = await fetchJson("https://registry.npmjs.org/pnpm");
  const time = isRecord(document) ? document["time"] : undefined;
  if (!isRecord(time)) {
    throw new Error("The npm registry gave pnpm's releases without their dates.");
  }
  const dates: Record<string, string> = {};
  for (const [version, date] of Object.entries(time)) {
    if (typeof date === "string") {
      dates[version] = date;
    }
  }
  return dates;
}

/** When each major version of Node.js reaches its end of life. */
async function nodeSchedule(): Promise<Record<string, { readonly end: string }>> {
  const schedule = await fetchJson(
    "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json",
  );
  if (!isRecord(schedule)) {
    throw new Error("The release schedule of Node.js is not an object.");
  }
  const ends: Record<string, { readonly end: string }> = {};
  for (const [major, release] of Object.entries(schedule)) {
    if (isRecord(release) && typeof release["end"] === "string") {
      ends[major] = { end: release["end"] };
    }
  }
  return ends;
}

async function main(): Promise<number> {
  const now = new Date();
  const problems: string[] = [];

  const manifest: unknown = JSON.parse(readText("package.json"));
  const packageManager = isRecord(manifest) ? manifest["packageManager"] : undefined;
  const pnpm = typeof packageManager === "string" ? pinnedPnpm(packageManager) : undefined;
  const age = /^minimumReleaseAge: (\d+)$/m.exec(readText("pnpm-workspace.yaml"))?.[1];
  if (pnpm === undefined || age === undefined) {
    throw new Error(
      "package.json must pin pnpm as pnpm@x.y.z+sha512.…, and pnpm-workspace.yaml give minimumReleaseAge.",
    );
  }
  const newer = newerPnpm(pnpm, await pnpmDates(), now, Number(age));
  if (newer === undefined) {
    process.stdout.write(`✓ pnpm ${pnpm} is the newest of its major version that is old enough.\n`);
  } else {
    problems.push(
      `pnpm ${newer} is out: pin it with \`corepack use pnpm@${newer}\`, which writes its hash into packageManager, then check its release notes.`,
    );
  }

  const major = nodeMajor(readText(".node-version"));
  if (major === undefined) {
    throw new Error(".node-version must give a major version of Node.js, such as 24.");
  }
  const end = nodeEndsSoon(major, await nodeSchedule(), now, NODE_WARNING_DAYS);
  if (end === undefined) {
    process.stdout.write(`✓ Node.js ${String(major)} is supported for more than six months.\n`);
  } else {
    problems.push(
      `Node.js ${String(major)} reaches its end of life on ${end}: move .node-version and CI to the next LTS version, with an ADR if Corepack is gone from it.`,
    );
  }

  for (const problem of problems) {
    process.stderr.write(`✗ ${problem}\n`);
  }
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = await main();
