import { DataLayerError } from "./errors.ts";
import { type Hlc, maxHlc } from "./hlc.ts";
import { type JsonValue, toJsonValue } from "./json.ts";
import { type DataRecord, assertWithinLimits, checkRecord } from "./record.ts";
import {
  type SchemaVersion,
  type Schemas,
  type StoreSchema,
  checkData,
  storeSchema,
} from "./schema.ts";

/** A record and the store it belongs to. */
export interface StoredRecord {
  readonly store: string;
  readonly record: DataRecord;
}

function has(object: object, key: string): boolean {
  return Object.hasOwn(object, key);
}

/** Runs an app's migration function; a failure fails the record, never the device. */
function run(compute: () => JsonValue, where: string): JsonValue {
  let value: JsonValue;
  try {
    value = compute();
  } catch (error) {
    throw new DataLayerError("invalid", `${where} failed.`, { cause: error });
  }
  return toJsonValue(value, `The result of ${where}`);
}

/** The default of a field of the previous version, which a missing field reads as. */
function defaultOf(store: StoreSchema, field: string): JsonValue {
  const value = has(store.fields, field) ? store.fields[field]?.defaultValue : undefined;
  return toJsonValue(value ?? null, `The default of ${field}`);
}

/**
 * One step: a record of `previous` becomes a record of `next` (data model §6), whose schema it
 * must then fit. The storage runs it for every record inside the database upgrade.
 */
export function migrateStep(
  previous: SchemaVersion,
  next: SchemaVersion,
  { store, record }: StoredRecord,
): StoredRecord {
  const migration =
    next.migrate !== undefined && has(next.migrate, store) ? next.migrate[store] : undefined;
  const before = storeSchema(previous, store);
  const target = migration?.store ?? store;
  const where = `the migration of record ${record.id} of ${store} to version ${next.version}`;
  const rename = migration?.rename ?? {};
  const convert = migration?.convert ?? {};
  const remove = new Set(migration?.remove ?? []);

  const data: Record<string, JsonValue> = {};
  const clock: Record<string, Hlc> = {};
  for (const [field, value] of Object.entries(record.data)) {
    const hlc = record.clock[field];
    if (remove.has(field) || hlc === undefined) {
      continue;
    }
    const name = has(rename, field) ? (rename[field] ?? field) : field;
    const conversion = has(convert, field) ? convert[field] : undefined;
    data[name] =
      conversion === undefined ? value : run(() => conversion(value), `${where} (${field})`);
    clock[name] = hlc;
  }
  for (const [name, computed] of Object.entries(migration?.compute ?? {})) {
    let hlc: Hlc | undefined;
    const values: Record<string, JsonValue> = {};
    for (const source of computed.from) {
      hlc = maxHlc(hlc, record.clock[source]);
      values[source] = has(record.data, source)
        ? (record.data[source] ?? null)
        : defaultOf(before, source);
    }
    // A field computed only from missing fields is missing too.
    if (hlc !== undefined) {
      data[name] = run(() => computed.value(values), `${where} (${name})`);
      clock[name] = hlc;
    }
  }

  const migrated: DataRecord =
    record.deleted === undefined
      ? { id: record.id, v: next.version, data, clock }
      : { id: record.id, v: next.version, data, clock, deleted: record.deleted };
  checkData(storeSchema(next, target), data, `record ${record.id} of ${target}`);
  assertWithinLimits(migrated);
  return { store: target, record: migrated };
}

/**
 * Migrates a record of `store` from its schema version to the current one, one version at a
 * time (data model §6). After each step, the result must fit that version's schema, which also
 * catches a faulty migration. Throws a `DataLayerError` otherwise.
 */
export function migrateRecord(schemas: Schemas, stored: StoredRecord): StoredRecord {
  let result = stored;
  for (let version = stored.record.v + 1; version <= schemas.current.version; version++) {
    result = migrateStep(schemas.version(version - 1), schemas.version(version), result);
  }
  if (result.record.v !== schemas.current.version) {
    throw new DataLayerError(
      "invalid",
      `Record ${stored.record.id} has schema version ${stored.record.v}, newer than ${schemas.current.version}.`,
    );
  }
  return result;
}

/**
 * Checks a record from outside, such as a backup, and migrates it to the current schema version
 * (data model §8): its structure, then its data against the schema of its own version, then the
 * migration, whose result is checked again. Throws a `DataLayerError`: `future-clock` for an HLC
 * more than 24 hours after `now`, `too-large` beyond a limit, `invalid` for anything else.
 */
export function checkIncomingRecord(
  schemas: Schemas,
  store: string,
  value: unknown,
  now: number,
): StoredRecord {
  const record = checkRecord(value, { store, version: schemas.current.version, now });
  checkData(
    storeSchema(schemas.version(record.v), store),
    record.data,
    `record ${record.id} of ${store}`,
  );
  return migrateRecord(schemas, { store, record });
}
