import { DataLayerError } from "./errors.ts";
import type { FieldType, TypeOf } from "./fields.ts";
import type { JsonObject, JsonValue } from "./json.ts";
import { SETTINGS_STORE, isFieldName, isStoreName } from "./names.ts";
import { MAX_FIELDS } from "./record.ts";

/** The fields of one store at one schema version (data model §2.3). */
export interface StoreSchema {
  readonly fields: Readonly<Record<string, FieldType<unknown>>>;
}

/** A store's values as an app reads them: every field, with defaults for missing ones. */
export type Values<S extends StoreSchema> = {
  readonly [K in keyof S["fields"]]: TypeOf<S["fields"][K]>;
};

/** A field of the new version computed from fields of the previous one (data model §6). */
export interface ComputedField {
  /** The fields of the previous version it is computed from. */
  readonly from: readonly [string, ...string[]];
  /**
   * Its value from theirs, where a missing field is given as its default. It must be pure and
   * deterministic: no time, random numbers, other records or anything about the device.
   */
  readonly value: (values: Readonly<Record<string, JsonValue>>) => JsonValue;
}

/**
 * How one store's records become records of the next version (data model §6). Fields are named
 * as in the previous version, except the new names that `rename` and `compute` give. Clocks
 * carry over as the spec requires:
 *
 * - `rename` moves a field, with its value and clock, to a new name;
 * - `convert` replaces a field's value with a new one, keeping its clock;
 * - `compute` gives a new field the greatest clock of the fields it is computed from, and
 *   leaves it missing if they all are;
 * - `remove` drops a field with its clock;
 * - `store` moves every record of the store, deleted ones included, to another store.
 *
 * Every other field keeps its name, value and clock. Fields that only the new version has are
 * missing, so they read as their defaults. Functions must be pure and deterministic, because
 * every device must turn the same record into the same result.
 */
export interface StoreMigration {
  readonly store?: string;
  readonly rename?: Readonly<Record<string, string>>;
  readonly convert?: Readonly<Record<string, (value: JsonValue) => JsonValue>>;
  readonly compute?: Readonly<Record<string, ComputedField>>;
  readonly remove?: readonly string[];
}

/** One version of an app's data schema (data model §6). */
export interface SchemaVersion {
  /** 1 for the first version, and 1 more for each later one. */
  readonly version: number;
  readonly stores: Readonly<Record<string, StoreSchema>>;
  /**
   * From version 2: how the records of each store of the previous version become records of
   * this one. A store that is not listed keeps its records as they are.
   */
  readonly migrate?: Readonly<Record<string, StoreMigration>>;
}

/** Every version an app's data schema has had, from 1 to the current one, `C`. */
export interface Schemas<C extends SchemaVersion = SchemaVersion> {
  readonly versions: readonly SchemaVersion[];
  /** The current version: the one this build of the app writes. */
  readonly current: C;
  /** The schema of version `n`; throws a `DataLayerError` for a version the app never had. */
  version(n: number): SchemaVersion;
}

/** The last of a list of versions. */
type Last<V extends readonly SchemaVersion[]> = V extends readonly [
  ...SchemaVersion[],
  infer L extends SchemaVersion,
]
  ? L
  : SchemaVersion;

function isLast<V extends readonly SchemaVersion[]>(
  versions: V,
  schema: SchemaVersion | undefined,
): schema is Last<V> {
  return schema !== undefined && versions.at(-1) === schema;
}

function fail(message: string): never {
  throw new Error(message);
}

function has(object: object, key: string): boolean {
  return Object.hasOwn(object, key);
}

function checkStores(schema: SchemaVersion): void {
  for (const [name, store] of Object.entries(schema.stores)) {
    const where = `Store ${name} of version ${schema.version}`;
    if (!isStoreName(name)) {
      fail(`"${name}" is not allowed as a store name (version ${schema.version}).`);
    }
    const fields = Object.entries(store.fields);
    if (fields.length > MAX_FIELDS) {
      fail(`${where} has more than ${MAX_FIELDS} fields.`);
    }
    for (const [fieldName, type] of fields) {
      if (!isFieldName(fieldName)) {
        fail(`${where} has a field named "${fieldName}", which is not allowed.`);
      }
      if (type.defaultValue === undefined) {
        fail(`${where} gives the field ${fieldName} no default; add one or make it nullable.`);
      }
      if (type.references !== undefined && !has(schema.stores, type.references)) {
        fail(
          `${where} refers to the store ${type.references}, which version ${schema.version} lacks.`,
        );
      }
    }
  }
}

function checkMigration(previous: SchemaVersion, next: SchemaVersion): void {
  const migrations = next.migrate ?? {};
  for (const store of Object.keys(migrations)) {
    if (!has(previous.stores, store)) {
      fail(
        `Version ${next.version} migrates the store ${store}, which version ${previous.version} lacks.`,
      );
    }
  }
  for (const [store, before] of Object.entries(previous.stores)) {
    const migration = has(migrations, store) ? migrations[store] : undefined;
    const where = `The migration of ${store} to version ${next.version}`;
    const target = migration?.store ?? store;
    const after = has(next.stores, target) ? next.stores[target] : undefined;
    if (after === undefined) {
      fail(
        `${where} needs a store ${target} in version ${next.version}: records are never removed.`,
      );
    }
    if ((store === SETTINGS_STORE) !== (target === SETTINGS_STORE)) {
      fail(`${where} moves records into or out of ${SETTINGS_STORE}.`);
    }

    const rename = migration?.rename ?? {};
    const convert = migration?.convert ?? {};
    const compute = migration?.compute ?? {};
    const remove = new Set(migration?.remove ?? []);
    const isOld = (name: string): boolean => has(before.fields, name);
    for (const name of [...Object.keys(rename), ...Object.keys(convert), ...remove]) {
      if (!isOld(name)) {
        fail(`${where} names the field ${name}, which version ${previous.version} lacks.`);
      }
    }
    for (const name of [...Object.keys(rename), ...Object.keys(convert)]) {
      if (remove.has(name)) {
        fail(`${where} both removes and keeps the field ${name}.`);
      }
    }

    // Every field of the new version gets at most one source.
    const targets = new Map<string, string>();
    const claim = (name: string, source: string): void => {
      if (!has(after.fields, name)) {
        fail(
          `${where} writes the field ${name}, which version ${next.version} of ${target} lacks.`,
        );
      }
      const other = targets.get(name);
      if (other !== undefined) {
        fail(`${where} writes the field ${name} from both ${other} and ${source}.`);
      }
      targets.set(name, source);
    };
    for (const name of Object.keys(before.fields)) {
      if (!remove.has(name)) {
        claim(has(rename, name) ? (rename[name] ?? name) : name, `the field ${name}`);
      }
    }
    for (const [name, computed] of Object.entries(compute)) {
      for (const source of computed.from) {
        if (!isOld(source)) {
          fail(
            `${where} computes ${name} from ${source}, which version ${previous.version} lacks.`,
          );
        }
      }
      claim(name, `the computation of ${name}`);
    }
  }
}

/**
 * Checks and returns every version of an app's data schema, oldest first. Throws an `Error` for
 * a mistake in any of them, such as a field without a default, a version that skips a number,
 * or a migration that names a field the schema lacks or would drop a store's records.
 *
 * Declare each version with `satisfies SchemaVersion`, so that `Values<typeof v2.stores.notes>`
 * gives the exact types of a store's values.
 */
export function defineSchemas<const V extends readonly [SchemaVersion, ...SchemaVersion[]]>(
  ...versions: V
): Schemas<Last<V>> {
  let previous: SchemaVersion | undefined;
  for (const [index, schema] of versions.entries()) {
    if (schema.version !== index + 1) {
      fail(`Schema versions must be 1, 2, 3 and so on; number ${index + 1} is ${schema.version}.`);
    }
    checkStores(schema);
    if (previous === undefined) {
      if (schema.migrate !== undefined) {
        fail("Version 1 has nothing to migrate from.");
      }
    } else {
      checkMigration(previous, schema);
    }
    previous = schema;
  }
  const current = versions.at(-1);
  if (!isLast(versions, current)) {
    throw new Error("There is no current version.");
  }
  return {
    versions,
    current,
    version(n) {
      const schema = Number.isSafeInteger(n) && n >= 1 ? versions[n - 1] : undefined;
      if (schema === undefined) {
        throw new DataLayerError("invalid", `There is no schema version ${n}.`);
      }
      return schema;
    },
  };
}

/**
 * The schema of `store` at version `schema`; throws a `DataLayerError` if that version has no
 * such store.
 */
export function storeSchema(schema: SchemaVersion, store: string): StoreSchema {
  const found = has(schema.stores, store) ? schema.stores[store] : undefined;
  if (found === undefined) {
    throw new DataLayerError("invalid", `Version ${schema.version} has no store ${store}.`);
  }
  return found;
}

/**
 * Checks that `data` is valid for a store (data model §8, step 2): only its fields, each of the
 * right type and within its constraints. Throws a `DataLayerError` that names the field.
 */
export function checkData(store: StoreSchema, data: JsonObject, where: string): void {
  for (const [name, value] of Object.entries(data)) {
    const type = has(store.fields, name) ? store.fields[name] : undefined;
    if (type === undefined) {
      throw new DataLayerError("invalid", `${where} has a field ${name}, which its store lacks.`);
    }
    if (!type.isValid(value)) {
      throw new DataLayerError(
        "invalid",
        `The field ${name} of ${where} is not ${type.description}.`,
      );
    }
  }
}

/** Whether `values` has every field of `store`, each valid for its type. */
function isValuesOf<S extends StoreSchema>(
  store: S,
  values: Readonly<Record<string, unknown>>,
): values is Values<S> {
  return Object.entries(store.fields).every(
    ([name, type]) => has(values, name) && type.isValid(values[name]),
  );
}

/**
 * A record's values as an app reads them: its fields, and the defaults of missing ones. Throws a
 * `DataLayerError` if a stored value does not fit the store's schema.
 */
export function readValues<S extends StoreSchema>(store: S, data: JsonObject): Values<S> {
  const values: Record<string, unknown> = {};
  for (const [name, type] of Object.entries(store.fields)) {
    values[name] = has(data, name) ? data[name] : type.defaultValue;
  }
  if (!isValuesOf(store, values)) {
    throw new DataLayerError("invalid", "A stored record does not fit its store's schema.");
  }
  return values;
}
