/**
 * Creates an app from the app template (architecture §6), in `apps/<id>`:
 *
 *   pnpm create-app <id> --name <name> --description <sentence> [--short-name <name>] [--accent <#rrggbb>]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { portOf } from "@shkriuss/checks/structure";
import * as prettier from "prettier";
import { TEMPLATE, appFiles, nextPort } from "./create.ts";

const USAGE = `Usage: pnpm create-app <id> --name <name> --description <sentence> [--short-name <name>] [--accent <#rrggbb>]

  <id>           The app's permanent id: its subdomain, as in <id>.shkriuss.app. Lowercase
                 letters, digits and inner hyphens. It never changes.
  --name         The app's name, as its frame and installed apps show it.
  --description  What the app does, in one sentence.
  --short-name   The name under its icon on a home screen, at most 12 characters, if the
                 name is longer.
  --accent       The color of its icons, as #rrggbb.`;

/** The repository's root: this file is in `tooling/create-app/src`. */
const root = path.resolve(import.meta.dirname, "../../..");

/**
 * The paths of the repository's files that `pathspecs` match: those in git, and new ones that
 * git does not ignore, as the repository's checks list them.
 */
function gitFiles(...pathspecs: string[]): string[] {
  const options = ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate"];
  const output = execFileSync("git", [...options, "--", ...pathspecs], {
    cwd: root,
    encoding: "utf8",
  });
  return output.split("\0").filter((file) => file !== "");
}

/** Whether `folder` was ever in the repository's history, as an app that was removed or renamed. */
function existedBefore(folder: string): boolean {
  const output = execFileSync("git", ["log", "--all", "--format=%H", "-1", "--", folder], {
    cwd: root,
    encoding: "utf8",
  });
  return output.trim() !== "";
}

async function main(args: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      name: { type: "string" },
      "short-name": { type: "string" },
      description: { type: "string" },
      accent: { type: "string" },
    },
  });
  const [id, ...more] = positionals;
  const { name, description } = values;
  if (id === undefined || more.length > 0 || name === undefined || description === undefined) {
    console.error(USAGE);
    return 2;
  }

  const folder = `apps/${id}`;
  if (existsSync(path.join(root, folder))) {
    console.error(`${folder} exists already.`);
    return 1;
  }
  if (existedBefore(folder)) {
    console.error(
      `${folder} existed before: an app's id is never used again (CLAUDE.md, product rule 3).`,
    );
    return 1;
  }

  const template = new Map<string, string>();
  for (const file of gitFiles(TEMPLATE)) {
    template.set(
      path.posix.relative(TEMPLATE, file),
      await readFile(path.join(root, file), "utf8"),
    );
  }
  const ports: number[] = [];
  for (const file of gitFiles("apps/*/playwright.config.ts", "tooling/*/playwright.config.ts")) {
    const port = portOf(await readFile(path.join(root, file), "utf8"))?.port;
    if (port !== undefined) {
      ports.push(port);
    }
  }

  let files: Map<string, string>;
  try {
    files = appFiles(
      {
        id,
        name,
        description,
        ...(values["short-name"] === undefined ? {} : { shortName: values["short-name"] }),
        ...(values.accent === undefined ? {} : { accent: values.accent }),
      },
      template,
      nextPort(ports),
    );
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }

  for (const [file, source] of files) {
    const target = path.join(root, file);
    const options = await prettier.resolveConfig(target);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await prettier.format(source, { ...options, filepath: target }));
  }
  console.log(`Created ${folder} from the app template. Next:

  pnpm install
  pnpm --filter @shkriuss/${id} dev

Then replace the example feature, src/features/items, with the app's own, and the glyph of its
icons in app.config.ts. Run pnpm verify before every push.`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
