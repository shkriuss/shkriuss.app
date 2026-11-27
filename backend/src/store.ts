// The server's D1 tables, and how every call reads and writes them.
// What is stored, and the row writes each write costs, are in
// sync-protocol.md, "What the server stores".
//
// Two habits run through this file and the calls:
// 1. Every query is one D1 batch, which D1 runs as one step. A call that
//    decides in code between a read and a write puts a guard first in its
//    write batch. The guard stops the whole batch, and the call starts
//    again, if what it read has changed since.
// 2. Blobs and IDs travel as hex: `unhex(?)` going in, `hex(column)` coming
//    out. D1 hands a blob to a Worker as an array of numbers, one for each
//    byte, which costs far more CPU time than one string of hex.

import { Refusal, FULL, WRITES_USED, WRITES_USED_FOR_ALL } from "./answers";
import { fromD1Hex } from "./bytes";

/** The part of D1 the server uses. The tests wrap it to count row writes. */
export interface Db {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** What a call needs from the world, passed in so that tests can set the clock. */
export interface Context {
  readonly db: Db;
  readonly files: R2Bucket;
  /** The secret `SETUP_CODE` of the Worker, if the user saved one. */
  readonly setupCode: string | undefined;
  /** The address a request came to: `https://`, the host and a port that is not 443. */
  readonly origin: string;
  now(): number;
  random(length: number): Uint8Array;
}

/** The version of the tables below. A later version moves them forward on its first request. */
export const SCHEMA_VERSION = 1;

export const NO_ACCOUNT = 0;
export const IN_USE = 1;
export const CLOSED_STATE = 2;

export const DEVICE_IN = 1;
export const DEVICE_REMOVED = 2;

export const MARK_NONE = 0;
export const MARK_DELETING = 1;
export const MARK_DELETED = 2;

/**
 * Every table is WITHOUT ROWID, so that no table has a hidden row ID, and
 * only `record` has a second index. So a stored record costs two row
 * writes and every other write one.
 */
const TABLES = [
  `CREATE TABLE IF NOT EXISTS server (
     one INTEGER PRIMARY KEY CHECK (one = 1),
     schema INTEGER NOT NULL,
     id BLOB NOT NULL,
     epoch BLOB NOT NULL,
     state INTEGER NOT NULL,
     account_key BLOB,
     key_id BLOB,
     revision INTEGER NOT NULL
   ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS device (
     id BLOB PRIMARY KEY,
     public_key BLOB NOT NULL,
     name BLOB NOT NULL,
     state INTEGER NOT NULL,
     added INTEGER NOT NULL,
     seen_day INTEGER NOT NULL
   ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS app (
     name TEXT PRIMARY KEY,
     head INTEGER NOT NULL
   ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS told (
     device BLOB NOT NULL,
     app TEXT NOT NULL,
     number INTEGER NOT NULL,
     PRIMARY KEY (device, app)
   ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS record (
     app TEXT NOT NULL,
     id BLOB NOT NULL,
     number INTEGER NOT NULL,
     blob BLOB NOT NULL,
     mark INTEGER NOT NULL,
     mark_time INTEGER NOT NULL,
     PRIMARY KEY (app, id)
   ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS record_by_number ON record (app, number)`,
  `CREATE TABLE IF NOT EXISTS device_code (
     one INTEGER PRIMARY KEY CHECK (one = 1),
     hash BLOB NOT NULL,
     ends INTEGER NOT NULL,
     tries INTEGER NOT NULL
   ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS used_setup_code (
     hash BLOB PRIMARY KEY
   ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS day_writes (
     one INTEGER PRIMARY KEY CHECK (one = 1),
     day INTEGER NOT NULL,
     writes INTEGER NOT NULL
   ) WITHOUT ROWID`,
  // The guard: inserting 1 does nothing and writes no row. Inserting
  // anything else stops the batch, and D1 rolls all of it back.
  `CREATE VIEW IF NOT EXISTS guard AS SELECT 1 AS ok`,
  `CREATE TRIGGER IF NOT EXISTS guard_holds INSTEAD OF INSERT ON guard
     WHEN NEW.ok IS NOT 1
     BEGIN SELECT RAISE(ABORT, 'shk-guard'); END`,
];

/** A write batch whose guard did not hold. The call starts again from its first read. */
export class GuardFailed extends Error {
  constructor() {
    super("guard");
    this.name = "GuardFailed";
  }
}

/**
 * Runs statements as one D1 batch. Turns D1's refusals for the day's
 * limits into `07 02`, and for a full database into `08`.
 */
export async function run<T = Record<string, unknown>>(
  db: Db,
  statements: D1PreparedStatement[],
): Promise<D1Result<T>[]> {
  try {
    return await db.batch<T>(statements);
  } catch (error) {
    throw translate(error);
  }
}

function translate(error: unknown): unknown {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("shk-guard")) return new GuardFailed();
  // The texts of D1's own list of errors, for the free plan's daily
  // limits and for a database or an account that is full.
  if (/free tier daily row (write|read) limit/.test(message)) {
    return new Refusal(WRITES_USED, Uint8Array.of(WRITES_USED_FOR_ALL));
  }
  if (/Exceeded maximum DB size|maximum account storage limit/.test(message)) {
    return new Refusal(FULL);
  }
  return error;
}

/** A statement that stops its batch unless `condition`, an SQL expression, is true. */
export function guard(db: Db, condition: string, ...values: unknown[]): D1PreparedStatement {
  return db.prepare(`INSERT INTO guard (ok) SELECT (${condition})`).bind(...values);
}

/** The server's one row. */
export interface ServerRow {
  readonly schema: number;
  readonly id: Uint8Array;
  readonly epoch: Uint8Array;
  readonly state: number;
  readonly accountKey: Uint8Array | null;
  readonly keyId: Uint8Array | null;
  readonly revision: number;
  /** All of the row in one string, for a guard that the row has not changed. */
  readonly fingerprint: string;
}

/** One device of the server. */
export interface DeviceRow {
  readonly id: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly name: Uint8Array;
  readonly state: number;
  readonly added: number;
  readonly seenDay: number;
}

const FINGERPRINT = `state || ':' || hex(epoch) || ':' || revision || ':' ||
  coalesce(hex(account_key), '') || ':' || coalesce(hex(key_id), '')`;

const SERVER_ROW = `SELECT schema, hex(id) AS id, hex(epoch) AS epoch, state,
  hex(account_key) AS account_key, hex(key_id) AS key_id, revision,
  ${FINGERPRINT} AS fingerprint FROM server WHERE one = 1`;

const DEVICE_ROW = `SELECT hex(id) AS id, hex(public_key) AS public_key, hex(name) AS name,
  state, added, seen_day FROM device`;

/** A guard that the server's row is still the one that was read. */
export function serverUnchanged(db: Db, server: ServerRow): D1PreparedStatement {
  return guard(db, `(SELECT ${FINGERPRINT} FROM server WHERE one = 1) = ?1`, server.fingerprint);
}

/** A guard that a device is still in. */
export function deviceStillIn(db: Db, deviceId: Uint8Array): D1PreparedStatement {
  return guard(db, `(SELECT state FROM device WHERE id = unhex(?1)) = ${DEVICE_IN}`, deviceId.toHex());
}

/**
 * Reads the server's row and, if an ID is given, that device's row. On
 * the first use of the database it makes the tables, the server's ID and
 * its first epoch ("The epoch", point 1).
 */
export async function openServer(
  context: Context,
  deviceId: Uint8Array | null,
): Promise<{ server: ServerRow; device: DeviceRow | null }> {
  let rows = await readServer(context.db, deviceId).catch(async (error: unknown) => {
    if (!(error instanceof Error) || !/no such table/.test(error.message)) throw error;
    return null;
  });
  if (rows === null || rows.server === null) {
    await makeTables(context);
    rows = await readServer(context.db, deviceId);
  }
  if (rows.server === null) throw new Error("the server's row is missing");
  if (rows.server.schema !== SCHEMA_VERSION) {
    // Version 1 has no older tables to move forward. A database of a
    // newer version than this code must not be written by it.
    throw new Error("the tables are of another version");
  }
  return { server: rows.server, device: rows.device };
}

async function readServer(
  db: Db,
  deviceId: Uint8Array | null,
): Promise<{ server: ServerRow | null; device: DeviceRow | null }> {
  const statements = [db.prepare(SERVER_ROW)];
  if (deviceId !== null) {
    statements.push(db.prepare(`${DEVICE_ROW} WHERE id = unhex(?1)`).bind(deviceId.toHex()));
  }
  const results = await run(db, statements);
  const serverRow = results[0]?.results[0];
  const deviceRow = results[1]?.results[0];
  return {
    server: serverRow === undefined ? null : toServerRow(serverRow),
    device: deviceRow === undefined ? null : toDeviceRow(deviceRow),
  };
}

async function makeTables(context: Context): Promise<void> {
  const db = context.db;
  const first = db
    .prepare(
      `INSERT INTO server (one, schema, id, epoch, state, revision)
       VALUES (1, ?1, unhex(?2), unhex(?3), ${NO_ACCOUNT}, 0)
       ON CONFLICT (one) DO NOTHING`,
    )
    .bind(SCHEMA_VERSION, context.random(16).toHex(), context.random(16).toHex());
  await run(db, [...TABLES.map((sql) => db.prepare(sql)), first]);
}

function toServerRow(row: Record<string, unknown>): ServerRow {
  return {
    schema: Number(row["schema"]),
    id: fromD1Hex(row["id"]),
    epoch: fromD1Hex(row["epoch"]),
    state: Number(row["state"]),
    accountKey: optionalHex(row["account_key"]),
    keyId: optionalHex(row["key_id"]),
    revision: Number(row["revision"]),
    fingerprint: String(row["fingerprint"]),
  };
}

/** One device's row, from a query that selects the columns of `DEVICE_ROW`. */
export function toDeviceRow(row: Record<string, unknown>): DeviceRow {
  return {
    id: fromD1Hex(row["id"]),
    publicKey: fromD1Hex(row["public_key"]),
    name: fromD1Hex(row["name"]),
    state: Number(row["state"]),
    added: Number(row["added"]),
    seenDay: Number(row["seen_day"]),
  };
}

/** The columns of every device, for `devices`. */
export const ALL_DEVICES = `${DEVICE_ROW} ORDER BY added, id`;

function optionalHex(value: unknown): Uint8Array | null {
  // SQLite's hex(NULL) is the empty string.
  return typeof value === "string" && value.length > 0 ? fromD1Hex(value) : null;
}
