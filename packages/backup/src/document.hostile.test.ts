import { isDeepStrictEqual } from "node:util";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type BackupContents, readBackup, writeBackup } from "./document.ts";
import { BackupError } from "./errors.ts";
import { APP, SCHEMAS, example } from "./test/fixtures.ts";

// A backup file is untrusted (CLAUDE.md; backup format §5). Whatever it holds, reading it either
// refuses it with a BackupError, or gives contents that write and read back the same: never
// another error, and never data that the checks would refuse.

const OPTIONS = { app: APP, schemas: SCHEMAS };

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * What reading `bytes` comes to: "refused" for a BackupError, and "stable" for contents that
 * write and read back the same. Anything else is returned as it is, such as another error, for
 * the test to show.
 */
function outcome(bytes: Uint8Array): unknown {
  let contents: BackupContents;
  try {
    contents = readBackup(bytes, OPTIONS);
  } catch (error) {
    return error instanceof BackupError ? "refused" : error;
  }
  const { version, stores } = contents.incoming;
  const snapshot = { schemaVersion: version, stores, fromFuture: undefined, counted: 0 };
  const again = readBackup(writeBackup(APP, snapshot, contents.exported), OPTIONS);
  return isDeepStrictEqual(again.exported, contents.exported) &&
    isDeepStrictEqual(again.incoming.stores, stores)
    ? "stable"
    : { contents, again };
}

/** Where a part of a JSON value is: the keys and indexes that lead to it. */
type Path = readonly (string | number)[];

/** The path of every part of `value`, `value` itself first. */
function paths(value: unknown, at: Path = []): Path[] {
  const found: Path[] = [at];
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      found.push(...paths(item, [...at, Array.isArray(value) ? Number(key) : key]));
    }
  }
  return found;
}

const REMOVE = Symbol("remove");

/** A copy of `value` with the part at `path` replaced by `replacement`, or removed. */
function changed(value: unknown, path: Path, replacement: unknown): unknown {
  const [step, ...rest] = path;
  if (step === undefined) {
    return replacement === REMOVE ? undefined : replacement;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const copy: object = Array.isArray(value) ? value.slice() : { ...value };
  if (rest.length > 0 || replacement !== REMOVE) {
    Reflect.set(copy, step, changed(Reflect.get(copy, step), rest, replacement));
  } else if (Array.isArray(copy)) {
    copy.splice(Number(step), 1);
  } else {
    Reflect.deleteProperty(copy, step);
  }
  return copy;
}

describe("readBackup, with hostile input (backup format §5)", () => {
  it("starts from a backup that it reads", () => {
    expect(outcome(encode(example()))).toBe("stable");
  });

  it("refuses any bytes with a BackupError, or reads them", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(["refused", "stable"]).toContain(outcome(bytes));
      }),
    );
  });

  it("refuses any JSON value with a BackupError, or reads it", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(["refused", "stable"]).toContain(outcome(encode(JSON.stringify(value))));
      }),
    );
  });

  it("refuses the example of §2 with any one part changed or removed, or reads it still valid", () => {
    const document: unknown = JSON.parse(example());
    const all = paths(document);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: all.length - 1 }),
        fc.oneof(fc.jsonValue(), fc.constant(REMOVE)),
        (index, replacement) => {
          const value = changed(document, all[index] ?? [], replacement);
          expect(["refused", "stable"]).toContain(outcome(encode(JSON.stringify(value) ?? "")));
        },
      ),
      { numRuns: 1000 },
    );
  });
});
