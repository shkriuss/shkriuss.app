import { Dexie, type Table, type Transaction } from "dexie";
import { createRecord, deleteRecord, updateRecord } from "./changes.ts";
import { DataLayerError } from "./errors.ts";
import {
  type ClockState,
  type Hlc,
  INITIAL_CLOCK,
  MAX_COUNTER,
  MAX_WALL,
  isDeviceId,
  issueHlc,
  newDeviceId,
} from "./hlc.ts";
import { SETTINGS_ID, newRecordId } from "./ids.ts";
import { type StoredRecord, migrateStep } from "./migrate.ts";
import { META_STORE, SETTINGS_STORE } from "./names.ts";
import { type DataRecord, isDeleted } from "./record.ts";
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

interface BackupState {
  readonly last: number | null;
  readonly changes: number;
}

const NO_BACKUP: BackupState = { last: null, changes: 0 };

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
  if (!isBackupState(row.value)) {
    throw new DataLayerError("invalid", "The database holds an invalid backup state.");
  }
  return row.value;
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
 * `error`, or the data layer's error it stands for. Dexie reports a closed database with an error
 * of its own, which holds the reason it could not reopen, if there is one.
 */
function translate(error: unknown): unknown {
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
 * before any is written, so a record moved into a store is not migrated a second time. Stores
 * that `next` lacks are deleted after this, when every record has moved out.
 */
async function upgrade(
  transaction: Transaction,
  previous: SchemaVersion,
  next: SchemaVersion,
): Promise<void> {
  const migrated: { readonly from: string; readonly to: StoredRecord }[] = [];
  for (const store of Object.keys(previous.stores)) {
    const records = await transaction.table<DataRecord, string>(store).toArray();
    for (const record of records) {
      migrated.push({ from: store, to: migrateStep(previous, next, { store, record }) });
    }
  }
  for (const { from, to } of migrated) {
    if (to.store !== from) {
      await transaction.table<DataRecord, string>(from).delete(to.record.id);
    }
    await transaction.table<DataRecord, string>(to.store).put(to.record);
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
  await dexie.open();
  return new Database(dexie, schemas, options.now ?? Date.now);
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
abstract class Reader<C extends SchemaVersion> {
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

  /** What the database knows about this device (data model §7). */
  async device(): Promise<DeviceState> {
    return translating(async () => {
      const [device, backup] = await this.#dexie
        .table<MetaRow, string>(META_STORE)
        .bulkGet(["device", "backup"]);
      const { last, changes } = backupOf(backup);
      return { device: deviceIdOf(device), lastBackup: last, changesSinceBackup: changes };
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
        const { last, changes } = backupOf(backup);
        await meta.put({ key: "backup", value: { last, changes: changes + 1 } });
      }
      return result;
    });
  }

  /**
   * Records that this device has just made a backup (backup format §4, step 5): its time, and
   * no changes since.
   */
  async recordBackup(): Promise<void> {
    const backup: BackupState = { last: this.#now(), changes: 0 };
    await translating(async () =>
      this.#dexie.table<MetaRow, string>(META_STORE).put({ key: "backup", value: backup }),
    );
  }

  /** Closes the database; it cannot be used afterwards. */
  close(): void {
    this.#dexie.close();
  }
}
