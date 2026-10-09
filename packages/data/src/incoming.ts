import { DataLayerError } from "./errors.ts";
import { type Hlc, maxHlc } from "./hlc.ts";
import { mergeRecords } from "./merge.ts";
import { migrateRecord } from "./migrate.ts";
import { type DataRecord, checkRecord, lastChange } from "./record.ts";
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

  /**
   * The greatest HLC in the backup, which the device receives (data model §3.4), and which the
   * import checks against this device's clock (§3.5).
   */
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

/**
 * Checks the stores of a backup that an app made at schema version `schemaVersion`, and
 * migrates their records to the current version (backup format §5.4, steps 5 and 6, and §5.5):
 *
 * - `stores` has exactly the stores of `schemaVersion`, each an array of records;
 * - every record passes the checks of data model §8 and has `v` equal to `schemaVersion`, and
 *   no other record of its store has its id.
 *
 * Two records that the migration puts into one store with the same id are copies of one record,
 * and merge (data model §6).
 *
 * Throws a `DataLayerError`: `newer-version` if `schemaVersion` is newer than the app's,
 * `too-large` beyond a limit, and `invalid` for anything else. One refused record refuses them
 * all. Clocks from the future pass: the preview shows them, and the import refuses them unless
 * the user has confirmed them (data model §3.5).
 */
export function checkIncomingStores(
  schemas: Schemas,
  schemaVersion: number,
  stores: unknown,
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

  const migrated = new Map<string, Map<string, DataRecord>>();
  for (const store of Object.keys(schemas.current.stores)) {
    migrated.set(store, new Map());
  }
  let greatest: Hlc | undefined;
  for (const store of names) {
    const values = stores[store];
    if (!Array.isArray(values)) {
      throw invalid(expected);
    }
    const before = storeSchema(schema, store);
    const ids = new Set<string>();
    for (const value of values) {
      const record = checkRecord(value, { store, version: schemaVersion });
      if (record.v !== schemaVersion) {
        throw invalid(`Record ${record.id} of ${store} is not at schema version ${schemaVersion}.`);
      }
      checkData(before, record.data, `record ${record.id} of ${store}`);
      // A store of a backup holds each id once.
      if (ids.has(record.id)) {
        throw invalid(`The backup has record ${record.id} twice in ${store}.`);
      }
      ids.add(record.id);
      greatest = maxHlc(greatest, lastChange(record));
      const result = migrateRecord(schemas, { store, record });
      const target = migrated.get(result.store);
      if (target === undefined) {
        throw invalid(`The app has no store ${result.store}.`);
      }
      const copy = target.get(result.record.id);
      target.set(
        result.record.id,
        copy === undefined ? result.record : mergeRecords(copy, result.record),
      );
    }
  }
  const version = schemas.current.version;
  const records = [...migrated].map(([store, byId]) => [store, [...byId.values()]] as const);
  return new Incoming(CHECKED, version, freeze(Object.fromEntries(records)), greatest);
}
