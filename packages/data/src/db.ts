import { Dexie, type Table, type Transaction, liveQuery } from "dexie";
import { createRecord, deleteRecord, updateRecord } from "./changes.ts";
import { DataLayerError } from "./errors.ts";
import {
  type ClockState,
  type Hlc,
  INITIAL_CLOCK,
  MAX_COUNTER,
  MAX_WALL,
  isDeviceId,
  isFromFuture,
  issueHlc,
  maxHlc,
  newDeviceId,
  receiveHlc,
  wallTime,
} from "./hlc.ts";
import { SETTINGS_ID, newRecordId } from "./ids.ts";
import { Incoming } from "./incoming.ts";
import { canonicalJson } from "./json.ts";
import { mergeRecords } from "./merge.ts";
import { migrateStep } from "./migrate.ts";
import { META_STORE, SETTINGS_STORE } from "./names.ts";
import { type DataRecord, isDeleted, lastChange, toJson } from "./record.ts";
import {
  type SchemaVersion,
  type Schemas,
  type StoreSchema,
  type Values,
  checkData,
  readValues,
  storeSchema,
} from "./schema.ts";

/** The name of every app's database (data model §7): one per origin, so one per app. */
export const DATABASE_NAME = "shkriuss";

/** The stores of the schema version `C`. */
export type StoreName<C extends SchemaVersion> = Extract<keyof C["stores"], string>;

/** The stores of records of `C`: every store but the settings. */
export type RecordStore<C extends SchemaVersion> = Exclude<StoreName<C>, typeof SETTINGS_STORE>;

/** The settings store of `C`, or `never` if it has none. */
export type SettingsStore<C extends SchemaVersion> = Extract<StoreName<C>, typeof SETTINGS_STORE>;

/** A live record as an app reads it: its id, and every field, with defaults for missing ones. */
export interface Item<C extends SchemaVersion, S extends StoreName<C>> {
  readonly id: string;
  readonly values: Values<C["stores"][S]>;
}

/** Values to write: any of a store's fields. */
export type Input<C extends SchemaVersion, S extends StoreName<C>> = Partial<
  Values<C["stores"][S]>
>;

/** What the database knows about this device (data model §7). */
export interface DeviceState {
  /** This device's id, which breaks ties between changes made at the same time. */
  readonly device: string;
  /** When this device last made a backup, in milliseconds since 1970; `null` if never. */
  readonly lastBackup: number | null;
  /** How many changes and imports have written something since then. */
  readonly changesSinceBackup: number;
}

/** Every record of every store, deleted ones included, at one moment (backup format §4). */
export interface Snapshot {
  /**
   * The schema version that every record has: the app's current one, or the database's own in a
   * snapshot of `rescueSnapshot()`.
   */
  readonly schemaVersion: number;
  readonly stores: Readonly<Record<string, readonly DataRecord[]>>;
  /**
   * The wall time of its greatest HLC, in milliseconds since 1970, if that lies more than 24
   * hours after this device's clock (data model §3.5): restoring a backup of it then asks the
   * user to confirm. `undefined` otherwise.
   */
  readonly fromFuture: number | undefined;
  /**
   * How many changes the device had counted when it took the snapshot, which `recordBackup()`
   * records once the backup is saved (data model §7).
   */
  readonly counted: number;
}

/** What an import does to the records of a store (backup format §5.6). */
export interface ImportCounts {
  /** Records the device did not have, which are alive. */
  readonly new: number;
  /** Records that change and are alive, including ones that come back after a deletion. */
  readonly updated: number;
  /** Records that were alive and become deleted. */
  readonly deleted: number;
  /** All others. */
  readonly unchanged: number;
}

/** What an import does, in total and for each store. */
export interface ImportSummary {
  readonly total: ImportCounts;
  readonly stores: Readonly<Record<string, ImportCounts>>;
  /**
   * How many records it writes: those that it counts as new, updated or deleted, and deletions
   * that change nothing the device shows, such as those of records it never had (backup format
   * §5.6, §5.7).
   */
  readonly writes: number;
}

/** What an import would do (backup format §5.6). */
export interface ImportPreview extends ImportSummary {
  /**
   * The wall time of the incoming greatest HLC, in milliseconds since 1970, if that lies more
   * than 24 hours after this device's clock (data model §3.5): the user must confirm it, and the
   * import must accept it. `undefined` otherwise.
   */
  readonly fromFuture: number | undefined;
}

export interface ImportOptions {
  /**
   * Whether the user has confirmed the times from the future that the preview showed (data model
   * §3.5). Without it, an import with an HLC from the future throws `future-clock`.
   */
  readonly acceptFromFuture?: boolean;
}

export interface DatabaseOptions {
  /** The IndexedDB to use instead of the browser's; tests pass fake-indexeddb's. */
  readonly indexedDB?: IDBFactory;
  /** The key ranges of that IndexedDB. */
  readonly IDBKeyRange?: typeof IDBKeyRange;
  /** This device's clock, in milliseconds since 1970; tests pass their own. */
  readonly now?: () => number;
  /**
   * Called when opening waits for other tabs, which still have an older version of the app open
   * and have not closed the database yet.
   */
  readonly onBlocked?: () => void;
  /**
   * Called when another tab needs the database closed: a newer version of the app upgrades it,
   * or something deletes it. It is closed by then and cannot be used anymore; the app must
   * reload.
   */
  readonly onVersionChange?: () => void;
}

/** A row of the `meta` store, which holds this device's state (data model §7). */
interface MetaRow {
  readonly key: string;
  readonly value: unknown;
}

/**
 * What the device knows about its backups (data model §7): when it last made one, how many
 * changes it has counted in all, and how many of them the snapshot of that backup had.
 */
interface BackupState {
  readonly last: number | null;
  readonly counted: number;
  readonly saved: number;
}

const NO_BACKUP: BackupState = { last: null, counted: 0, saved: 0 };

function isWithin(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function isClock(value: unknown): value is ClockState {
  return (
    typeof value === "object" &&
    value !== null &&
    "wall" in value &&
    "counter" in value &&
    isWithin(value.wall, MAX_WALL) &&
    isWithin(value.counter, MAX_COUNTER)
  );
}

function isBackupState(value: unknown): value is BackupState {
  return (
    typeof value === "object" &&
    value !== null &&
    "last" in value &&
    "counted" in value &&
    "saved" in value &&
    (value.last === null || Number.isSafeInteger(value.last)) &&
    isWithin(value.counted, Number.MAX_SAFE_INTEGER) &&
    isWithin(value.saved, value.counted)
  );
}

/** The state as earlier versions stored it: only how many changes the last backup lacks. */
function isEarlierBackupState(
  value: unknown,
): value is { readonly last: number | null; readonly changes: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "last" in value &&
    "changes" in value &&
    (value.last === null || Number.isSafeInteger(value.last)) &&
    isWithin(value.changes, Number.MAX_SAFE_INTEGER)
  );
}

function deviceIdOf(row: MetaRow | undefined): string {
  const value = row?.value;
  if (!isDeviceId(value)) {
    throw new DataLayerError("invalid", "The database has no valid device id.");
  }
  return value;
}

function clockOf(row: MetaRow | undefined): ClockState {
  if (row === undefined) {
    return INITIAL_CLOCK;
  }
  if (!isClock(row.value)) {
    throw new DataLayerError("invalid", "The database holds an invalid clock.");
  }
  return row.value;
}

function backupOf(row: MetaRow | undefined): BackupState {
  if (row === undefined) {
    return NO_BACKUP;
  }
  if (isBackupState(row.value)) {
    return row.value;
  }
  if (isEarlierBackupState(row.value)) {
    // The next write stores it as it is now.
    return { last: row.value.last, counted: row.value.changes, saved: 0 };
  }
  throw new DataLayerError("invalid", "The database holds an invalid backup state.");
}

/** The state after one more change that wrote something. */
function counting(state: BackupState): BackupState {
  return { ...state, counted: state.counted + 1 };
}

/**
 * Dexie keeps IndexedDB's version at ten times the schema version, and adds 1 whenever it repairs
 * a database whose stores differ from its schema.
 */
const NATIVE_VERSIONS = 10;

/** Whether IndexedDB's version `native` belongs to a schema version after `current`. */
function isNewer(native: number, current: number): boolean {
  return native >= (current + 1) * NATIVE_VERSIONS;
}

/**
 * `factory`, except that it refuses to open a database at an IndexedDB version that belongs to a
 * schema version after `current`. Dexie asks for one to repair a newer database that lacks
 * stores of the older schemas it was given: it would add them, and work with the newer records.
 * Refused, the open fails instead, and the newer database stays as it is.
 */
export function refusingNewer(factory: IDBFactory, current: number): IDBFactory {
  return {
    cmp: (first: unknown, second: unknown) => factory.cmp(first, second),
    databases: async () => factory.databases(),
    deleteDatabase: (name: string) => factory.deleteDatabase(name),
    open(name: string, version?: number) {
      if (version === undefined) {
        return factory.open(name);
      }
      if (isNewer(version, current)) {
        throw new DOMException(
          `Version ${version} of ${name} is newer than this app.`,
          "VersionError",
        );
      }
      return factory.open(name, version);
    },
  };
}

/**
 * Whether `error` is the browser's refusal of a write for lack of storage space, which Dexie
 * passes on as an error of the same name, or in an error that it wraps around it.
 */
function isQuotaExceeded(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 3) {
    return false;
  }
  if ("name" in error && error.name === "QuotaExceededError") {
    return true;
  }
  const inner: unknown = "inner" in error ? error.inner : undefined;
  const failures: unknown = "failures" in error ? error.failures : undefined;
  return (
    isQuotaExceeded(inner, depth + 1) ||
    (Array.isArray(failures) &&
      failures.some((failure: unknown) => isQuotaExceeded(failure, depth + 1)))
  );
}

/** The data layer's error for a write that the browser refused for lack of space. */
function storageFull(cause: unknown): DataLayerError {
  return new DataLayerError("storage-full", "The device has no storage space left.", { cause });
}

/**
 * `error`, or the data layer's error it stands for: `storage-full` for a write that the browser
 * refused for lack of space. Dexie reports a closed database with an error of its own, which
 * holds the reason it could not reopen, if there is one.
 */
function translate(error: unknown): unknown {
  if (isQuotaExceeded(error)) {
    return storageFull(error);
  }
  if (!(error instanceof Dexie.DatabaseClosedError)) {
    return error;
  }
  return error.inner instanceof DataLayerError
    ? error.inner
    : new DataLayerError("closed", "The database is closed.", { cause: error });
}

/** Runs `operation`, with Dexie's errors translated. */
async function translating<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw translate(error);
  }
}

/** One version's object stores, as Dexie declares them; `null` deletes a store. */
function storesOf(
  schema: SchemaVersion,
  previous: SchemaVersion | undefined,
): Record<string, string | null> {
  const stores: Record<string, string | null> = { [META_STORE]: "key" };
  for (const name of Object.keys(previous?.stores ?? {})) {
    stores[name] = null;
  }
  for (const name of Object.keys(schema.stores)) {
    stores[name] = "id";
  }
  return stores;
}

/**
 * Migrates every record of `previous` to `next` inside the upgrade transaction (data model §6),
 * so the database moves to the new version completely or not at all. Every record is read
 * before any is written, so a record moved into a store is not migrated a second time, and
 * records leave their stores before any is written, so that none written is then deleted. Two
 * records that the migration puts into one store with the same id are copies of one record, and
 * merge. Stores that `next` lacks are deleted after this, when every record has moved out.
 */
async function upgrade(
  transaction: Transaction,
  previous: SchemaVersion,
  next: SchemaVersion,
): Promise<void> {
  const moved: { readonly from: string; readonly id: string }[] = [];
  const results = new Map<string, Map<string, DataRecord>>();
  for (const store of Object.keys(previous.stores)) {
    const records = await transaction.table<DataRecord, string>(store).toArray();
    for (const record of records) {
      const to = migrateStep(previous, next, { store, record });
      if (to.store !== store) {
        moved.push({ from: store, id: record.id });
      }
      const target = results.get(to.store) ?? new Map<string, DataRecord>();
      results.set(to.store, target);
      const copy = target.get(to.record.id);
      target.set(to.record.id, copy === undefined ? to.record : mergeRecords(copy, to.record));
    }
  }
  for (const { from, id } of moved) {
    await transaction.table<DataRecord, string>(from).delete(id);
  }
  for (const [store, records] of results) {
    await transaction.table<DataRecord, string>(store).bulkPut([...records.values()]);
  }
}

/**
 * Opens the app's database (data model §7), creating it, or upgrading it to the current schema
 * version first. The migrations of every version since the database's own run in the upgrade
 * transaction: if one fails, the database stays as it was and the promise rejects. Rejects with
 * a `DataLayerError` `newer-version`, and leaves the database untouched, if a newer version of
 * the app has upgraded it already.
 */
export async function openDatabase<C extends SchemaVersion>(
  schemas: Schemas<C>,
  options: DatabaseOptions = {},
): Promise<Database<C>> {
  const current = schemas.current.version;
  const dexie = new Dexie(DATABASE_NAME, {
    // These apps hold the only copy of their users' data: every change reaches the disk first.
    chromeTransactionDurability: "strict",
    indexedDB: refusingNewer(options.indexedDB ?? indexedDB, current),
    ...(options.IDBKeyRange === undefined ? {} : { IDBKeyRange: options.IDBKeyRange }),
  });
  let previous: SchemaVersion | undefined;
  for (const schema of schemas.versions) {
    const version = dexie.version(schema.version).stores(storesOf(schema, previous));
    if (previous !== undefined) {
      const from = previous;
      version.upgrade(async (transaction) => {
        await upgrade(transaction, from, schema);
      });
    }
    previous = schema;
  }
  dexie.on("populate", (transaction) =>
    transaction.table<MetaRow, string>(META_STORE).add({ key: "device", value: newDeviceId() }),
  );
  // Dexie opens a newer database as it is if it has every store of the given schemas. This
  // refuses it, at every open: Dexie also reopens the database by itself, for example when the
  // page comes back from the back-forward cache.
  dexie.on(
    "ready",
    (ready: Dexie) => {
      if (isNewer(ready.backendDB().version, current)) {
        throw new DataLayerError(
          "newer-version",
          "A newer version of the app has upgraded the database already.",
        );
      }
    },
    true,
  );
  dexie.on("blocked", () => {
    options.onBlocked?.();
  });
  // Instead of Dexie's own handler, which logs to the console and lets the database reopen.
  dexie.on("versionchange", () => {
    dexie.close();
    options.onVersionChange?.();
    return false;
  });
  try {
    await dexie.open();
  } catch (error) {
    // As when an upgrade needs more space than the device has left.
    throw isQuotaExceeded(error) ? storageFull(error) : error;
  }
  return new Database(dexie, schemas, options.now ?? Date.now);
}

/**
 * The app's records as the database stores them, at the database's own schema version, for a
 * backup when the app cannot open it, as when an upgrade failed (data model §7; backup format
 * §4). It opens the database as it is, without upgrading it, reads every store of that version
 * but `meta` in one transaction, and changes nothing. It throws a `DataLayerError` `not-found` if
 * the device has no database of the app, `newer-version` if a newer version of the app has
 * upgraded it, and `invalid` if its version is none of the app's.
 */
export async function rescueSnapshot(
  schemas: Schemas,
  options: DatabaseOptions = {},
): Promise<Snapshot> {
  // Without versions, Dexie opens the database at the version it has, and creates none.
  const dexie = new Dexie(DATABASE_NAME, {
    indexedDB: options.indexedDB ?? indexedDB,
    ...(options.IDBKeyRange === undefined ? {} : { IDBKeyRange: options.IDBKeyRange }),
  });
  try {
    try {
      await dexie.open();
    } catch (error) {
      if (error instanceof Dexie.NoSuchDatabaseError) {
        throw new DataLayerError("not-found", "The device has no database of the app.", {
          cause: error,
        });
      }
      throw translate(error);
    }
    const version = dexie.verno;
    if (version > schemas.current.version) {
      throw new DataLayerError(
        "newer-version",
        `The database has schema version ${version}, newer than ${schemas.current.version}.`,
      );
    }
    const schema = schemas.versions.find((known) => known.version === version);
    if (schema === undefined) {
      throw new DataLayerError("invalid", `The database has schema version ${version}.`);
    }
    const stores = Object.keys(schema.stores);
    const now = options.now ?? Date.now;
    return await translating(async () =>
      dexie.transaction("r", stores, async (transaction) => {
        const records: Record<string, DataRecord[]> = {};
        let greatest: Hlc | undefined;
        for (const store of stores) {
          records[store] = await transaction.table<DataRecord, string>(store).toArray();
          for (const record of records[store]) {
            greatest = maxHlc(greatest, lastChange(record));
          }
        }
        // Nothing records this backup: the database stays as it is (backup format §4).
        return {
          schemaVersion: version,
          stores: records,
          fromFuture: fromFuture(greatest, now()),
          counted: 0,
        };
      }),
    );
  } finally {
    dexie.close();
  }
}

type Outcome = keyof ImportCounts;

/** The wall time of `hlc` if it lies more than 24 hours after `now` (data model §3.5). */
function fromFuture(hlc: Hlc | undefined, now: number): number | undefined {
  return hlc !== undefined && isFromFuture(hlc, now) ? wallTime(hlc) : undefined;
}

function isSame(a: DataRecord, b: DataRecord): boolean {
  return canonicalJson(toJson(a)) === canonicalJson(toJson(b));
}

/**
 * An incoming record merged with the local copy (data model §5): the result, what it does to the
 * local copy (backup format §5.6), and whether it must be written because it differs (§5.7).
 */
function mergeIncoming(
  local: DataRecord | undefined,
  incoming: DataRecord,
): { readonly merged: DataRecord; readonly outcome: Outcome; readonly write: boolean } {
  if (local === undefined) {
    // A tombstone of a record the device never had changes nothing it shows, but it is kept,
    // so that an older backup cannot bring the record back.
    return { merged: incoming, outcome: isDeleted(incoming) ? "unchanged" : "new", write: true };
  }
  const merged = mergeRecords(local, incoming);
  if (isSame(local, merged)) {
    return { merged, outcome: "unchanged", write: false };
  }
  if (!isDeleted(merged)) {
    return { merged, outcome: "updated", write: true };
  }
  return { merged, outcome: isDeleted(local) ? "unchanged" : "deleted", write: true };
}

function noCounts(): Record<Outcome, number> {
  return { new: 0, updated: 0, deleted: 0, unchanged: 0 };
}

/**
 * Merges every incoming record with its local copy, read in `transaction`: what that does to
 * each store, and the records that differ from their local copies.
 */
async function mergeAll(
  transaction: Transaction,
  incoming: Incoming,
): Promise<{ readonly summary: ImportSummary; readonly writes: Map<string, DataRecord[]> }> {
  const total = noCounts();
  const stores: Record<string, ImportCounts> = {};
  const writes = new Map<string, DataRecord[]>();
  let count = 0;
  for (const [store, records] of Object.entries(incoming.stores)) {
    const counts = noCounts();
    const changed: DataRecord[] = [];
    const locals = await transaction
      .table<DataRecord, string>(store)
      .bulkGet(records.map((record) => record.id));
    for (const [index, record] of records.entries()) {
      const { merged, outcome, write } = mergeIncoming(locals[index], record);
      counts[outcome] += 1;
      total[outcome] += 1;
      if (write) {
        changed.push(merged);
      }
    }
    stores[store] = counts;
    writes.set(store, changed);
    count += changed.length;
  }
  return { summary: { total, stores, writes: count }, writes };
}

/** Whether `schema` is the schema of `store` in `version`. */
function isStoreOf<C extends SchemaVersion, S extends StoreName<C>>(
  version: C,
  store: S,
  schema: StoreSchema | undefined,
): schema is C["stores"][S] {
  return schema !== undefined && version.stores[store] === schema;
}

/** The schema of `store` in `version`; throws a `DataLayerError` for a store it lacks. */
function schemaOf<C extends SchemaVersion, S extends StoreName<C>>(
  version: C,
  store: S,
): C["stores"][S] {
  const schema = Object.hasOwn(version.stores, store) ? version.stores[store] : undefined;
  if (!isStoreOf(version, store, schema)) {
    throw new DataLayerError("invalid", `The app has no store ${store}.`);
  }
  return schema;
}

/**
 * `store`, which must be a store of records: the settings have methods of their own, which keep
 * them to their one record.
 */
function recordStore<S extends string>(store: S): S {
  const name: string = store;
  if (name === SETTINGS_STORE) {
    throw new DataLayerError("invalid", `The ${SETTINGS_STORE} store holds settings, not records.`);
  }
  return store;
}

/** Reads of live records and settings, at the current schema version. */
export abstract class Reader<C extends SchemaVersion> {
  /** Every version of the app's data schema; the database is at the current one. */
  readonly schemas: Schemas<C>;

  constructor(schemas: Schemas<C>) {
    this.schemas = schemas;
  }

  /** The object store of `store`. */
  protected abstract table(store: string): Table<DataRecord, string>;

  /** Runs one of the reads below. */
  protected abstract read<T>(read: () => Promise<T>): Promise<T>;

  /** A record's id and values; `undefined` if it is missing or deleted. */
  async get<S extends RecordStore<C>>(store: S, id: string): Promise<Item<C, S> | undefined> {
    return this.read(async () => {
      const schema = schemaOf(this.schemas.current, recordStore(store));
      const record = await this.table(store).get(id);
      if (record === undefined || isDeleted(record)) {
        return undefined;
      }
      return { id: record.id, values: readValues(schema, record.data) };
    });
  }

  /**
   * The ids and values of every live record of `store`, sorted by id: by the time each was
   * created, to the millisecond.
   */
  async list<S extends RecordStore<C>>(store: S): Promise<Item<C, S>[]> {
    return this.read(async () => {
      const schema = schemaOf(this.schemas.current, recordStore(store));
      const records = await this.table(store).toArray();
      return records
        .filter((record) => !isDeleted(record))
        .map((record) => ({ id: record.id, values: readValues(schema, record.data) }));
    });
  }

  /** The app's settings, with defaults for those never written. */
  async settings(): Promise<Values<C["stores"][SettingsStore<C>]>> {
    return this.read(async () => {
      const store = settingsStore(this.schemas.current);
      const schema = schemaOf(this.schemas.current, store);
      const record = await this.table(store).get(SETTINGS_ID);
      return readValues(schema, record?.data ?? {});
    });
  }
}

/** The settings store of `schema`; throws a `DataLayerError` if it has none. */
function settingsStore<C extends SchemaVersion>(schema: C): SettingsStore<C> {
  const store: string = SETTINGS_STORE;
  if (!isSettingsStore(schema, store)) {
    throw new DataLayerError("invalid", `The app has no store ${SETTINGS_STORE}.`);
  }
  return store;
}

function isSettingsStore<C extends SchemaVersion>(
  schema: C,
  store: string,
): store is SettingsStore<C> {
  return store === SETTINGS_STORE && Object.hasOwn(schema.stores, store);
}

/**
 * The writes of one change: one transaction, with one HLC for all of them (data model §4). Its
 * reads see its own writes.
 */
export class Change<C extends SchemaVersion> extends Reader<C> {
  readonly #transaction: Transaction;
  readonly #now: () => number;
  /** The HLC that every write of this change carries. */
  readonly hlc: Hlc;
  #written = false;

  constructor(schemas: Schemas<C>, transaction: Transaction, now: () => number, hlc: Hlc) {
    super(schemas);
    this.#transaction = transaction;
    this.#now = now;
    this.hlc = hlc;
  }

  /** Whether the change has written anything. */
  get written(): boolean {
    return this.#written;
  }

  protected table(store: string): Table<DataRecord, string> {
    return this.#transaction.table<DataRecord, string>(store);
  }

  // Errors reach the app through the change, which translates them.
  protected read<T>(read: () => Promise<T>): Promise<T> {
    return read();
  }

  async #read(store: string, id: string): Promise<DataRecord> {
    storeSchema(this.schemas.current, recordStore(store));
    const record = await this.table(store).get(id);
    if (record === undefined) {
      throw new DataLayerError("not-found", `There is no record ${id} in ${store}.`);
    }
    return record;
  }

  async #write(store: string, before: DataRecord | undefined, after: DataRecord): Promise<void> {
    if (after === before) {
      return;
    }
    checkData(storeSchema(this.schemas.current, store), after.data, `record ${after.id}`);
    await this.table(store).put(after);
    this.#written = true;
  }

  /** Creates a record with `values` and returns its new id (data model §4.1). */
  async create<S extends RecordStore<C>>(store: S, values: Input<C, S>): Promise<string> {
    const id = newRecordId(this.#now());
    const record = createRecord(id, this.schemas.current.version, values, this.hlc);
    await this.#write(recordStore(store), undefined, record);
    return id;
  }

  /**
   * Writes `values` to a record (data model §4.2). Throws a `DataLayerError`: `not-found` if
   * there is no such record, `deleted` if it is deleted.
   */
  async update<S extends RecordStore<C>>(store: S, id: string, values: Input<C, S>): Promise<void> {
    const before = await this.#read(store, id);
    await this.#write(store, before, updateRecord(before, values, this.hlc));
  }

  /**
   * Deletes a record, leaving its tombstone (data model §4.3); does nothing if it is deleted
   * already. Throws a `DataLayerError` `not-found` if there is no such record.
   */
  async delete(store: RecordStore<C>, id: string): Promise<void> {
    const before = await this.#read(store, id);
    await this.#write(store, before, deleteRecord(before, this.hlc));
  }

  /** Writes `values` to the app's settings, which travel with its backups (data model §2.5). */
  async updateSettings(values: Input<C, SettingsStore<C>>): Promise<void> {
    const store = settingsStore(this.schemas.current);
    if (Object.keys(values).length === 0) {
      return;
    }
    const before = await this.table(store).get(SETTINGS_ID);
    const after =
      before === undefined
        ? createRecord(SETTINGS_ID, this.schemas.current.version, values, this.hlc)
        : updateRecord(before, values, this.hlc);
    await this.#write(store, before, after);
  }
}

/** Receives the results of an observed query (`Database.observe()`). */
export interface Observer<T> {
  /** A result: the first one, then one after each change that may have changed it. */
  next(value: T): void;
  /** The query failed, and the observation has ended: no result follows. */
  error(error: unknown): void;
}

/** An observation, which ends when it is unsubscribed. */
export interface Subscription {
  unsubscribe(): void;
}

/** The results of a query over time (`Database.observe()`). */
export interface Observable<T> {
  subscribe(observer: Observer<T>): Subscription;
}

/** An app's open database: its records, and what it knows about this device. */
export class Database<C extends SchemaVersion> extends Reader<C> {
  readonly #dexie: Dexie;
  readonly #now: () => number;

  constructor(dexie: Dexie, schemas: Schemas<C>, now: () => number) {
    super(schemas);
    this.#dexie = dexie;
    this.#now = now;
  }

  protected table(store: string): Table<DataRecord, string> {
    return this.#dexie.table<DataRecord, string>(store);
  }

  protected read<T>(read: () => Promise<T>): Promise<T> {
    return translating(read);
  }

  /**
   * The results of `query`, now and after every change that may change them, made in this tab
   * or in another one (architecture §7). `query` reads with the reader it gets, and awaits
   * only those reads. A change runs it again only if it wrote what `query` read: a record it
   * got, or a store it listed. An error of a read, such as `closed`, ends the observation.
   */
  observe<T>(query: (reader: Reader<C>) => Promise<T>): Observable<T> {
    const results = liveQuery(async () => query(this));
    return {
      subscribe(observer) {
        const subscription = results.subscribe({
          next: (value) => {
            observer.next(value);
          },
          error: (error: unknown) => {
            observer.error(error);
          },
        });
        return {
          unsubscribe: () => {
            subscription.unsubscribe();
          },
        };
      },
    };
  }

  /** What the database knows about this device (data model §7). */
  async device(): Promise<DeviceState> {
    return translating(async () => {
      const [device, backup] = await this.#dexie
        .table<MetaRow, string>(META_STORE)
        .bulkGet(["device", "backup"]);
      const { last, counted, saved } = backupOf(backup);
      return { device: deviceIdOf(device), lastBackup: last, changesSinceBackup: counted - saved };
    });
  }

  /**
   * Runs one change (data model §4): one transaction over every store, with one new HLC for all
   * its writes. Inside `write`, await only the change's own methods: awaiting anything else
   * would end the transaction early, which Dexie reports as an error. If `write` throws,
   * nothing changes. A change that writes something counts as a change since the last backup.
   */
  async change<T>(write: (change: Change<C>) => Promise<T>): Promise<T> {
    const stores = [...Object.keys(this.schemas.current.stores), META_STORE];
    return translating(async () => this.#transaction(stores, write));
  }

  #transaction<T>(stores: string[], write: (change: Change<C>) => Promise<T>): Promise<T> {
    return this.#dexie.transaction("rw", stores, async (transaction) => {
      const meta = transaction.table<MetaRow, string>(META_STORE);
      const [device, clock, backup] = await meta.bulkGet(["device", "clock", "backup"]);
      const issued = issueHlc(clockOf(clock), this.#now(), deviceIdOf(device));
      await meta.put({ key: "clock", value: issued.clock });
      const change = new Change(this.schemas, transaction, this.#now, issued.hlc);
      const result = await write(change);
      if (change.written) {
        await meta.put({ key: "backup", value: counting(backupOf(backup)) });
      }
      return result;
    });
  }

  /**
   * Every record of every store, deleted ones included, read in one transaction, so that a
   * backup is a consistent snapshot (backup format §4, step 1).
   */
  async snapshot(): Promise<Snapshot> {
    const stores = Object.keys(this.schemas.current.stores);
    return translating(async () =>
      this.#dexie.transaction("r", [...stores, META_STORE], async (transaction) => {
        const records: Record<string, DataRecord[]> = {};
        let greatest: Hlc | undefined;
        for (const store of stores) {
          records[store] = await transaction.table<DataRecord, string>(store).toArray();
          for (const record of records[store]) {
            greatest = maxHlc(greatest, lastChange(record));
          }
        }
        const backup = await transaction.table<MetaRow, string>(META_STORE).get("backup");
        return {
          schemaVersion: this.schemas.current.version,
          stores: records,
          fromFuture: fromFuture(greatest, this.#now()),
          counted: backupOf(backup).counted,
        };
      }),
    );
  }

  #checked(incoming: Incoming): Incoming {
    if (!Incoming.isChecked(incoming) || incoming.version !== this.schemas.current.version) {
      throw new DataLayerError(
        "invalid",
        "Only records that checkIncomingStores() checked for this app can be imported.",
      );
    }
    return incoming;
  }

  /**
   * What importing `incoming` would do, store by store (backup format §5.6), and whether it has
   * an HLC from the future (data model §3.5). It merges each record with its local copy in memory
   * and writes nothing.
   */
  async previewImport(incoming: Incoming): Promise<ImportPreview> {
    const checked = this.#checked(incoming);
    const stores = [...Object.keys(this.schemas.current.stores), META_STORE];
    const { summary } = await translating(async () =>
      this.#dexie.transaction("r", stores, async (transaction) => mergeAll(transaction, checked)),
    );
    return { ...summary, fromFuture: fromFuture(checked.greatest, this.#now()) };
  }

  /**
   * Imports `incoming` in one transaction over every store (backup format §5.7): merges each
   * record with its local copy, read again in the transaction, and writes the result if it
   * differs; receives the greatest HLC of the backup (data model §3.4); and counts the import
   * as a change since the last backup if it wrote anything. If anything fails, nothing changes.
   * Importing the same backup again changes nothing.
   *
   * An HLC from the future (data model §3.5) is imported only with `acceptFromFuture`, once the
   * user has confirmed what the preview showed; otherwise it throws a `DataLayerError`
   * `future-clock`.
   */
  async import(incoming: Incoming, options: ImportOptions = {}): Promise<ImportSummary> {
    const checked = this.#checked(incoming);
    if (
      options.acceptFromFuture !== true &&
      fromFuture(checked.greatest, this.#now()) !== undefined
    ) {
      throw new DataLayerError(
        "future-clock",
        "The records have clocks more than 24 hours in the future, which the user has not confirmed.",
      );
    }
    const stores = [...Object.keys(this.schemas.current.stores), META_STORE];
    return translating(async () =>
      this.#dexie.transaction("rw", stores, async (transaction) => {
        const { summary, writes } = await mergeAll(transaction, checked);
        let written = false;
        for (const [store, records] of writes) {
          if (records.length > 0) {
            await transaction.table<DataRecord, string>(store).bulkPut(records);
            written = true;
          }
        }
        const meta = transaction.table<MetaRow, string>(META_STORE);
        const [clock, backup] = await meta.bulkGet(["clock", "backup"]);
        if (checked.greatest !== undefined) {
          const last = clockOf(clock);
          const received = receiveHlc(last, checked.greatest);
          if (received !== last) {
            await meta.put({ key: "clock", value: received });
          }
        }
        if (written) {
          await meta.put({ key: "backup", value: counting(backupOf(backup)) });
        }
        return summary;
      }),
    );
  }

  /**
   * Records that this device has just made a backup (backup format §4, step 5): its time, and
   * that it has the changes that its snapshot counted, `counted` of `snapshot()`. Changes made
   * since the snapshot still count as changes since the backup.
   */
  async recordBackup(counted: number): Promise<void> {
    await translating(async () =>
      this.#dexie.transaction("rw", [META_STORE], async (transaction) => {
        const meta = transaction.table<MetaRow, string>(META_STORE);
        const state = backupOf(await meta.get("backup"));
        // A backup of an older snapshot, recorded late, takes nothing from a newer one.
        const saved = Math.max(state.saved, Math.min(counted, state.counted));
        const value: BackupState = { last: this.#now(), counted: state.counted, saved };
        await meta.put({ key: "backup", value });
      }),
    );
  }

  /** Closes the database; it cannot be used afterwards. */
  close(): void {
    this.#dexie.close();
  }
}
