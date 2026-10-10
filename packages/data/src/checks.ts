import { type JsonValue, canonicalJson, toJsonValue } from "./json.ts";
import { type StoredRecord, migrateRecord, migrateStep } from "./migrate.ts";
import { type DataRecord, toJson } from "./record.ts";
import type { SchemaVersion, Schemas, StoreSchema } from "./schema.ts";

/**
 * Checks for an app's own tests, which hold its schema versions to data model §6: a migration is
 * deterministic, and a version that shipped never changes.
 */

/** The signature of a field's type, and its default as canonical JSON. */
export interface FieldSignature {
  /** `FieldType.signature`: exactly which values the field holds. */
  readonly type: string;
  /** What a missing field reads as. */
  readonly default: JsonValue;
}

/** Version → store → field → the field's signature. */
export type SchemaSignatures = Readonly<
  Record<number, Readonly<Record<string, Readonly<Record<string, FieldSignature>>>>>
>;

/**
 * The type signature and the default of every field of every store of every version. A test
 * that holds the map of a version that shipped to a literal catches a change to it, which data
 * model §6 forbids: any change to the stores, their fields, the values they hold or their
 * defaults needs a new version, because the database and every backup carry the version's
 * number, not its schema.
 */
export function schemaSignatures(schemas: Schemas): SchemaSignatures {
  const versions: Record<number, Record<string, Record<string, FieldSignature>>> = {};
  for (const schema of schemas.versions) {
    const stores: Record<string, Record<string, FieldSignature>> = {};
    for (const [store, { fields }] of Object.entries(schema.stores)) {
      const signatures: Record<string, FieldSignature> = {};
      for (const [name, type] of Object.entries(fields)) {
        // defineSchemas() refuses a field without a default.
        signatures[name] = {
          type: type.signature,
          default: toJsonValue(type.defaultValue ?? null),
        };
      }
      stores[store] = signatures;
    }
    versions[schema.version] = stores;
  }
  return versions;
}

/** A clock for the records that the checks make up. */
const CLOCK = "000000000000001:00000:0000000000000000";

/** A record of `store` at version `version` with `data`, every field written by `CLOCK`. */
function record(version: number, data: Readonly<Record<string, JsonValue>>): DataRecord {
  const clock = Object.fromEntries(Object.keys(data).map((field) => [field, CLOCK]));
  return { id: "00000000-0000-7000-8000-000000000001", v: version, data, clock };
}

/** Records that try a store's migration: without fields, with each field alone, and with all. */
function samplesOf(
  previous: SchemaVersion,
  store: string,
  schema: StoreSchema,
): readonly { readonly what: string; readonly record: DataRecord }[] {
  const defaults: Record<string, JsonValue> = {};
  for (const [name, type] of Object.entries(schema.fields)) {
    defaults[name] = toJsonValue(type.defaultValue ?? null);
  }
  const at = `of ${store} at version ${previous.version}`;
  return [
    { what: `a record ${at} without fields`, record: record(previous.version, {}) },
    ...Object.entries(defaults).map(([name, value]) => ({
      what: `a record ${at} with only the field ${name} at its default`,
      record: record(previous.version, { [name]: value }),
    })),
    {
      what: `a record ${at} with every field at its default`,
      record: record(previous.version, defaults),
    },
    {
      what: `a deleted record ${at}`,
      record: { ...record(previous.version, {}), deleted: CLOCK },
    },
  ];
}

/** `stored` with the members of its data and clock in the opposite order. */
function reversed({ store, record: original }: StoredRecord): StoredRecord {
  const data = Object.fromEntries(Object.entries(original.data).toReversed());
  const clock = Object.fromEntries(Object.entries(original.clock).toReversed());
  return { store, record: { ...original, data, clock } };
}

/** What a migration's result comes to, whatever the order of its members. */
function key({ store, record: migrated }: StoredRecord): string {
  return `${store}: ${canonicalJson(toJson(migrated))}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `migrate` on `stored` twice, and once with the members of its data and clock in the
 * opposite order: the problem with the results, if they differ, or if the migration fails.
 */
function problemsOf(
  where: string,
  what: string,
  stored: StoredRecord,
  migrate: (stored: StoredRecord) => StoredRecord,
): string[] {
  let first: string;
  let again: string;
  let reordered: string;
  try {
    first = key(migrate(stored));
    again = key(migrate(stored));
    reordered = key(migrate(reversed(stored)));
  } catch (error) {
    return [`${where} fails for ${what}: ${messageOf(error)}`];
  }
  if (again !== first) {
    return [`${where} gives different results for ${what} when it runs twice.`];
  }
  if (reordered !== first) {
    return [`${where} depends on the order of the fields of ${what}.`];
  }
  return [];
}

/**
 * The problems with the migrations of `schemas`, for a test to show: an empty list if there are
 * none. Each migration runs twice on records of its store at the previous version, made up to
 * try every field at its default, and on every record of `samples`, such as those of the app's
 * backup fixtures, from its version to the current one; a result that differs between the runs,
 * or with the fields in another order, or a migration that fails for one of them, is a problem.
 * A migration that reads the time, random numbers or anything else outside its input (data
 * model §6) is caught where that shows in its results.
 */
export function migrationProblems(
  schemas: Schemas,
  samples: readonly StoredRecord[] = [],
): string[] {
  const problems: string[] = [];
  for (const next of schemas.versions.slice(1)) {
    const previous = schemas.version(next.version - 1);
    for (const [store, schema] of Object.entries(previous.stores)) {
      const where = `The migration of ${store} to version ${next.version}`;
      for (const { what, record: sample } of samplesOf(previous, store, schema)) {
        const stored = { store, record: sample };
        problems.push(
          ...problemsOf(where, what, stored, (given) => migrateStep(previous, next, given)),
        );
      }
    }
  }
  for (const sample of samples) {
    const where = `The migration of ${sample.store} from version ${sample.record.v}`;
    const what = `record ${sample.record.id}`;
    problems.push(...problemsOf(where, what, sample, (given) => migrateRecord(schemas, given)));
  }
  return problems;
}
