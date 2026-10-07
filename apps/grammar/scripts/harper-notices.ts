/**
 * Writes src/features/check/harper.ts, whose legal comment gives the notices of the Rust crates
 * compiled into the slim WebAssembly module of harper.js (ADR 0014). The build copies the
 * comment into /licenses.txt. Run it whenever harper.js changes version, with a checkout of
 * Harper at that version's tag, and Rust's cargo, which downloads the crates' sources:
 *
 *   git clone --depth 1 --branch v<version> https://github.com/Automattic/harper <checkout>
 *   node apps/grammar/scripts/harper-notices.ts <checkout>
 *
 * It lists the crates that `cargo tree` gives for harper-wasm without its default features, as
 * the slim module is built, for WebAssembly. That may name a few that the compiler leaves out,
 * never fewer than are in the module.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const app = path.resolve(import.meta.dirname, "..");
const target = path.join(app, "src/features/check/harper.ts");

/** The MIT License's terms, which follow the copyright notices of the crates under it. */
const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/** The licenses that the crates are used under, in the order of the texts. */
const LICENSES = ["MIT", "Apache-2.0", "MPL-2.0", "Unicode-3.0", "Zlib", "CC0-1.0"] as const;
type License = (typeof LICENSES)[number];

/**
 * The licenses that a crate is used under, from its license expression: the first of a choice
 * that is in `LICENSES`, and every one of a conjunction.
 */
function licensesOf(expression: string): License[] {
  const chosen: License[] = [];
  for (const part of expression.replaceAll(/[()]/g, "").split(" AND ")) {
    const options = part.split(/ OR |\//).map((option) => option.trim());
    const license = LICENSES.find((candidate) => options.includes(candidate));
    if (license === undefined) {
      throw new Error(`No license of ${JSON.stringify(expression)} is one that the notices know.`);
    }
    chosen.push(license);
  }
  return chosen;
}

/** A crate of crates.io, as `cargo tree` lists it. */
interface Crate {
  readonly name: string;
  readonly version: string;
  readonly license: string;
}

function cratesOf(checkout: string): Crate[] {
  const output = execFileSync(
    "cargo",
    [
      "tree",
      "--manifest-path",
      path.join(checkout, "Cargo.toml"),
      "--package",
      "harper-wasm",
      "--no-default-features",
      "--target",
      "wasm32-unknown-unknown",
      "--edges",
      "normal",
      "--prefix",
      "none",
      "--format",
      "{p}|{l}",
      "--locked",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const crates = new Map<string, Crate>();
  for (const line of output.split("\n")) {
    // A crate listed before is marked (*), at the end of its line.
    const match = /^(\S+) v(\S+)( \([^|]*\))?\|(.*?)(?: \(\*\))?$/.exec(line);
    // Harper's own crates, from the checkout, are harper.js's, under its license.
    if (match === null || match[3]?.includes("/") === true) {
      continue;
    }
    const [, name = "", version = "", , license = ""] = match;
    crates.set(`${name} ${version}`, { name, version, license: license.trim() });
  }
  return [...crates.values()].toSorted((a, b) => a.name.localeCompare(b.name, "en"));
}

/** The source of a crate, which cargo downloaded for `cargo tree`. */
function sourceOf(crate: Crate): string {
  const registry = path.join(
    process.env["CARGO_HOME"] ?? path.join(homedir(), ".cargo"),
    "registry",
    "src",
  );
  for (const index of readdirSync(registry)) {
    const directory = path.join(registry, index, `${crate.name}-${crate.version}`);
    if (existsSync(directory)) {
      return directory;
    }
  }
  throw new Error(`No source of ${crate.name} ${crate.version} in ${registry}.`);
}

/** The text of a crate's license files, by name: LICENSE, LICENSE-MIT, COPYING, NOTICE… */
function licenseFiles(source: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(source).toSorted()) {
    if (/^(?:licen[cs]e|copying|notice|unlicense)/i.test(name)) {
      files.set(
        name,
        readFileSync(path.join(source, name), "utf8").replaceAll("\r\n", "\n").trim(),
      );
    }
  }
  return files;
}

/**
 * The copyright notices in license files: lines such as "Copyright (c) 2015 Ann Smith" or
 * "(C) 2024 Example Foundation", without the templates and the terms of the licenses' texts.
 */
function copyrights(texts: Iterable<string>): string[] {
  const notices = new Set<string>();
  for (const text of texts) {
    for (const line of text.split("\n")) {
      const notice = line.trim().replaceAll(/\s+/g, " ");
      if (
        /^(?:Copyright|COPYRIGHT) (?:\([cC]\)|©|\d{4}|[A-Z])|^(?:\([cC]\)|©) ?\d{4}/.test(notice) &&
        !/\[yyyy\]|\{yyyy\}|<year>|\[name of copyright owner\]|permission notice/i.test(notice)
      ) {
        notices.add(notice);
      }
    }
  }
  return [...notices];
}

/** `line` in lines of at most 96 characters, broken at spaces, as the repository's code is. */
function wrap(line: string): string[] {
  const lines: string[] = [];
  let rest = line;
  while (rest.length > 96) {
    const space = rest.lastIndexOf(" ", 96);
    if (space <= 0) {
      break;
    }
    lines.push(rest.slice(0, space));
    rest = rest.slice(space + 1);
  }
  return [...lines, rest];
}

function main(checkout: string | undefined): void {
  if (checkout === undefined) {
    throw new Error("Usage: node apps/grammar/scripts/harper-notices.ts <checkout of Harper>");
  }
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(app, "node_modules/harper.js/package.json"), "utf8"),
  );
  const version =
    typeof manifest === "object" && manifest !== null && "version" in manifest
      ? manifest.version
      : undefined;
  if (typeof version !== "string") {
    throw new Error("harper.js has no version.");
  }
  const wasm = readFileSync(path.join(checkout, "harper-wasm/Cargo.toml"), "utf8");
  if (!wasm.includes(`version = "${version}"`)) {
    throw new Error(`The checkout is not Harper ${version}, which harper.js has.`);
  }

  const texts = new Map<License, string>([["MIT", MIT_TERMS]]);
  const entries: string[] = [];
  const notices: string[] = [];
  for (const crate of cratesOf(checkout)) {
    const licenses = licensesOf(crate.license);
    const files = licenseFiles(sourceOf(crate));
    for (const license of licenses) {
      if (!texts.has(license)) {
        const file = [...files].find(([name, text]) =>
          license === "Apache-2.0"
            ? /apache/i.test(name) || text.includes("Apache License")
            : !/mit|apache/i.test(name),
        );
        if (file === undefined) {
          throw new Error(
            `${crate.name} ${crate.version} has no file with the text of ${license}.`,
          );
        }
        texts.set(license, file[1]);
      }
    }
    const notice = copyrights(files.values());
    entries.push(
      `${crate.name} ${crate.version}, ${licenses.join(" and ")}${notice.length === 0 ? "" : `: ${notice.join("; ")}`}`,
    );
    for (const [name, text] of files) {
      if (/^notice/i.test(name)) {
        notices.push(`The NOTICE of ${crate.name} ${crate.version}:\n\n${text}`);
      }
    }
  }

  const comment = [
    `Harper's slim WebAssembly module, of harper.js ${version} (Apache-2.0), which this file loads, has compiled into it the Rust crates below, of crates.io, each under the license named: where a crate offers a choice, under the first of those below that it offers. Each crate's copyright notices follow its name, and the licenses' texts follow the list.`,
    "The source code of each crate is at https://crates.io/crates/<name>/<version>. For the crates under the Mozilla Public License 2.0, that is where to get their source code (section 3.2 of the license).",
    ...entries,
    ...notices,
    ...LICENSES.filter((license) => texts.has(license)).map(
      (license) => `The text of ${license}:\n\n${texts.get(license) ?? ""}`,
    ),
  ].join("\n\n");
  if (comment.includes("*/")) {
    throw new Error("A notice has */ in it, which would end the legal comment.");
  }
  const lines = comment
    .split("\n")
    .flatMap(wrap)
    .map((line) => (line === "" ? " *" : ` * ${line}`));
  const source = readFileSync(target, "utf8");
  const code = source.slice(source.indexOf("*/") + 2).trimStart();
  writeFileSync(target, `/*!\n${lines.join("\n")}\n */\n${code}`);
  process.stdout.write(`Wrote the notices of ${String(entries.length)} crates into ${target}.\n`);
}

main(process.argv[2]);
