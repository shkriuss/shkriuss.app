import { readFileSync } from "node:fs";
import {
  type Database,
  type SchemaVersion,
  defineSchemas,
  field,
  openDatabase,
} from "@shkriuss/data";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

/** What the backup tests share: the app of the backup format's example, and its data. */

export const APP = "notes";

/** The data of the example in backup format §2. */
export const v1 = {
  version: 1,
  stores: {
    notes: { fields: { title: field.string({ maxLength: 100 }), done: field.boolean() } },
    settings: { fields: { sortBy: field.enum(["title", "date"]) } },
  },
} satisfies SchemaVersion;

export const SCHEMAS = defineSchemas(v1);

/** The example of backup format §2, as the spec has it. */
export function example(): string {
  const spec = readFileSync(
    new URL("../../../../docs/specs/backup-format.md", import.meta.url),
    "utf8",
  );
  const json = /```json\n(.*?)\n```/s.exec(spec)?.[1];
  if (json === undefined) {
    throw new Error("The backup format spec has no example.");
  }
  return json;
}

/** The passphrase of the encrypted examples, and of encrypted backups in tests. */
export const EXAMPLE_PASSPHRASE = "burst-swarm-slender-curve-ability-various";

/**
 * The example of backup format §2, encrypted with `EXAMPLE_PASSPHRASE` by the age command-line
 * tool, version 1.1.1: `age --passphrase`, or with `--armor` for the ASCII-armored form. Its work
 * factor is 18. Like every backup fixture, these files never change (§8).
 */
export function encryptedExample(form: "binary" | "armored"): Uint8Array {
  const file = form === "binary" ? "example.age" : "example.armored.age";
  return new Uint8Array(readFileSync(new URL(file, import.meta.url)));
}

/** A new database of the example's app, on a device of its own. */
export function openTestDatabase(now: () => number = Date.now): Promise<Database<typeof v1>> {
  return openDatabase(SCHEMAS, { indexedDB: new IDBFactory(), IDBKeyRange, now });
}
