import { DataLayerError } from "./errors.ts";
import { type Hlc, maxHlc } from "./hlc.ts";
import { migrateRecord } from "./migrate.ts";
import { type DataRecord, checkRecord } from "./record.ts";
import { type Schemas, checkData, storeSchema } from "./schema.ts";

/** Only this module can make an `Incoming`. */
const CHECKED: unique symbol = Symbol("checked");

/** Every `Incoming` this module made: a mark that no other code can forge. */
const made = new WeakSet<object>();

/**
 * The records of a backup, checked and migrated to the current schema version (backup format
 * §5.4, §5.5), ready to preview and import. Only `checkIncomingStores()` makes one, so nothing
 * unchecked can be imported, and nothing can change it in between: its records are frozen.
 */
export class Incoming {
  // Private, so that TypeScript takes no other object for one.
  readonly #version: number;
  readonly #stores: Readonly<Record<string, readonly DataRecord[]>>;
  readonly #greatest: Hlc | undefined;

  constructor(
    checked: typeof CHECKED,
    version: number,
    stores: Readonly<Record<string, readonly DataRecord[]>>,
    greatest: Hlc | undefined,
  ) {
    if (checked !== CHECKED) {
      throw new TypeError("Only checkIncomingStores() makes incoming records.");
    }
    this.#version = version;
    this.#stores = stores;
    this.#greatest = greatest;
    made.add(this);
  }

  /** The schema version that the records were migrated to: the app's current one. */
  get version(): number {
    return this.#version;
  }

  /** The records, by store of that version. */
  get stores(): Readonly<Record<string, readonly DataRecord[]>> {
    return this.#stores;
  }

  /** The greatest HLC in the backup, which the device receives (data model §3.4). */
  get greatest(): Hlc | undefined {
    return this.#greatest;
  }

  /** Whether `value` was made by `checkIncomingStores()`. */
  static isChecked(value: unknown): value is Incoming {
    return typeof value === "object" && value !== null && made.has(value);
  }
}

function invalid(message: string): DataLayerError {
  return new DataLayerError("invalid", message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const member of Object.values(value)) {
      freeze(member);
    }
    Object.freeze(value);
  }
  return value;
}

/** The greatest HLC of a record: its tombstone, and the clocks of all its fields. */
function greatestOf(record: DataRecord): Hlc | undefined {
  let greatest = record.deleted;
  for (const hlc of Object.values(record.clock)) {
    greatest = maxHlc(greatest, hlc);
  }
  return greatest;
}

/**
 * Checks the stores of a backup that an app made at schema version `schemaVersion`, and
 * migrates their records to the current version (backup format §5.4, steps 5 and 6, and §5.5):
 *
 * - `stores` has exactly the stores of `schemaVersion`, each an array of records;
 * - every record passes the checks of data model §8 and has `v` equal to `schemaVersion`, and
 *   no other record of its store has its id, before or after the migration.
 *
 * Throws a `DataLayerError`: `newer-version` if `schemaVersion` is newer than the app's,
 * `future-clock` for an HLC more than 24 hours after `now`, `too-large` beyond a limit, and
 * `invalid` for anything else. One refused record refuses them all.
 */
export function checkIncomingStores(
  schemas: Schemas,
  schemaVersion: number,
  stores: unknown,
  now: number,
): Incoming {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw invalid("A backup's schema version is an integer from 1.");
  }
  if (schemaVersion > schemas.current.version) {
    throw new DataLayerError(
      "newer-version",
      `The backup has schema version ${schemaVersion}, newer than ${schemas.current.version}.`,
    );
  }
  const schema = schemas.version(schemaVersion);
  const names = Object.keys(schema.stores);
  const expected = `A backup of schema version ${schemaVersion} has the stores ${names.join(", ")}, each an array of records.`;
  // With as many stores as expected, and each of them an array, there is no other.
  if (!isObject(stores) || Object.keys(stores).length !== names.length) {
    throw invalid(expected);
  }

  const migrated = new Map<string, DataRecord[]>();
  const ids = new Map<string, Set<string>>();
  for (const store of Object.keys(schemas.current.stores)) {
    migrated.set(store, []);
    ids.set(store, new Set());
  }
  let greatest: Hlc | undefined;
  for (const store of names) {
    const values = stores[store];
    if (!Array.isArray(values)) {
      throw invalid(expected);
    }
    const before = storeSchema(schema, store);
    for (const value of values) {
      const record = checkRecord(value, { store, version: schemaVersion, now });
      if (record.v !== schemaVersion) {
        throw invalid(`Record ${record.id} of ${store} is not at schema version ${schemaVersion}.`);
      }
      checkData(before, record.data, `record ${record.id} of ${store}`);
      greatest = maxHlc(greatest, greatestOf(record));
      const result = migrateRecord(schemas, { store, record });
      // A store holds each id once: in the backup, and after a migration that merges stores.
      const seen = ids.get(result.store);
      if (seen === undefined || seen.has(result.record.id)) {
        throw invalid(`The backup has record ${result.record.id} twice in ${result.store}.`);
      }
      seen.add(result.record.id);
      migrated.get(result.store)?.push(result.record);
    }
  }
  const version = schemas.current.version;
  return new Incoming(CHECKED, version, freeze(Object.fromEntries(migrated)), greatest);
}
