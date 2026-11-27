// Fetching a page and sending a batch (sync-protocol.md: "Fetch",
// "Send", "Numbers, cursors and the epoch").

import { DONE, OTHER_EPOCH, Refusal, TOO_MUCH, WRITES_USED, WRITES_USED_FOR_COMPARISON } from "../answers";
import { LayoutError, Reader, Writer, fromD1Hex, fromHex, sameBytes } from "../bytes";
import type { SignedCall } from "../call";
import {
  COMPARISON_DAY_WRITES,
  DAY_MS,
  FORMAT_MOST_RECORDS,
  MARK_STALE_MS,
  MOST_BYTES,
  MOST_RECORDS,
  SEALED_RECORD_MAX,
  SEALED_RECORD_MIN,
} from "../limits";
import { appName, decimal, readQuery } from "../request";
import {
  MARK_DELETED,
  MARK_DELETING,
  MARK_NONE,
  deviceStillIn,
  run,
  serverUnchanged,
  type Context,
  type ServerRow,
} from "../store";

const STORED = 0x00;
const CHANGED_AFTER_CURSOR = 0x01;
const OTHER_KEY_ID = 0x02;
const NOT_A_SEALED_RECORD = 0x03;
const STORED_SEND_STREAM_AGAIN = 0x04;
const CHUNKS_BEING_DELETED = 0x05;

const COMPARISON = 0x01;

/** The first six bytes of a sealed record: `SHK`, version 1, kind 1, Tink's prefix version 1. */
const SEALED_RECORD_START = Uint8Array.of(0x53, 0x48, 0x4b, 0x01, 0x01, 0x01);

/**
 * The page of an app above Since: lowest number first, at most `?3`
 * records, cut where the blobs pass `?4` bytes, but always the first
 * record. One more record is read than a page may hold, to tell whether
 * more wait. The blobs of the records outside the page are not read.
 */
const PAGE = `
  WITH candidate AS (
    SELECT id, number, length(blob) AS size FROM record
    WHERE app = ?1 AND number > ?2 ORDER BY number LIMIT ?3 + 1
  ), counted AS (
    SELECT id, number,
      sum(size) OVER (ORDER BY number) AS total,
      row_number() OVER (ORDER BY number) AS n
    FROM candidate
  )
  SELECT hex(counted.id) AS id, counted.number AS number,
    CASE WHEN counted.n <= ?3 AND (counted.n = 1 OR counted.total <= ?4)
      THEN hex(record.blob) END AS blob
  FROM counted JOIN record ON record.app = ?1 AND record.id = counted.id
  ORDER BY counted.number`;

/**
 * `GET /v1/changes`: one page of an app's records above Since. The
 * records and the head are read in one step, so no record can get a
 * number at or below Through after the page was read.
 */
export async function fetchChanges(call: SignedCall): Promise<Uint8Array> {
  const { context, server, device, url } = call;
  const query = readQuery(url, ["app", "since", "known", "epoch", "most"]);
  const app = appName(query.get("app"));
  const since = decimal(query.get("since"));
  const known = decimal(query.get("known"));
  const epoch = fromHex(query.get("epoch") ?? "", 16);
  const most = decimal(query.get("most"));
  if (epoch === null || most < 1 || most > FORMAT_MOST_RECORDS) throw new LayoutError("query values");
  const limit = Math.min(most, MOST_RECORDS);
  const db = context.db;
  const [epochResult, toldResult, headResult, pageResult] = await run(db, [
    db.prepare("SELECT hex(epoch) AS epoch FROM server WHERE one = 1"),
    db.prepare("SELECT number FROM told WHERE device = unhex(?1) AND app = ?2").bind(device.id.toHex(), app),
    db.prepare("SELECT head FROM app WHERE name = ?1").bind(app),
    db.prepare(PAGE).bind(app, since, limit, MOST_BYTES),
  ]);
  const serverEpoch = fromD1Hex(epochResult?.results[0]?.["epoch"]);
  if (!sameBytes(epoch, serverEpoch)) throw new Refusal(OTHER_EPOCH, serverEpoch);
  const told = Number(toldResult?.results[0]?.["number"] ?? 0);
  if (known > told) throw await newEpoch(context, server);
  const head = Number(headResult?.results[0]?.["head"] ?? 0);
  const candidates = pageResult?.results ?? [];
  const page = candidates.filter((row) => row["blob"] !== null);
  const cut = page.length < candidates.length;
  const through = cut ? Number(page[page.length - 1]?.["number"]) : head;
  if (through > told) {
    await run(db, [
      db
        .prepare(
          `INSERT INTO told (device, app, number) VALUES (unhex(?1), ?2, ?3)
           ON CONFLICT (device, app) DO UPDATE SET number = excluded.number
           WHERE excluded.number > told.number`,
        )
        .bind(device.id.toHex(), app, through),
    ]);
  }
  const writer = new Writer()
    .u8(DONE)
    .bytes(serverEpoch)
    .i64(since)
    .i64(through)
    .u8(cut ? 0x01 : 0x00)
    .u32(page.length);
  for (const row of page) {
    const blob = fromD1Hex(row["blob"]);
    writer.bytes(fromD1Hex(row["id"])).i64(Number(row["number"])).u32(blob.byteLength).bytes(blob);
  }
  return writer.finish();
}

/**
 * A device knows a higher number than the server remembers telling it:
 * the database was put back. The server makes a new epoch, forgets what
 * it told every device, and answers `0B` ("The epoch", point 2).
 */
async function newEpoch(context: Context, server: ServerRow): Promise<Refusal> {
  const epoch = context.random(16);
  const db = context.db;
  await run(db, [
    serverUnchanged(db, server),
    db.prepare("UPDATE server SET epoch = unhex(?1) WHERE one = 1").bind(epoch.toHex()),
    db.prepare("DELETE FROM told"),
  ]);
  return new Refusal(OTHER_EPOCH, epoch);
}

interface SentRecord {
  readonly id: Uint8Array;
  readonly blob: Uint8Array;
}

interface Batch {
  readonly epoch: Uint8Array;
  readonly cursor: number;
  readonly known: number;
  readonly comparison: boolean;
  readonly records: readonly SentRecord[];
  readonly blobBytes: number;
}

function readBatch(body: Uint8Array): Batch {
  const reader = new Reader(body);
  const epoch = reader.take(16);
  const cursor = reader.count64();
  const known = reader.count64();
  const kind = reader.u8();
  if (kind !== 0x00 && kind !== COMPARISON) throw new LayoutError("kind of batch");
  const count = reader.u32();
  if (count < 1 || count > FORMAT_MOST_RECORDS) throw new LayoutError("count");
  const records: SentRecord[] = [];
  let blobBytes = 0;
  for (let i = 0; i < count; i++) {
    const id = reader.take(16);
    const length = reader.u32();
    records.push({ id, blob: reader.take(length) });
    blobBytes += length;
  }
  reader.end();
  return { epoch, cursor, known, comparison: kind === COMPARISON, records, blobBytes };
}

/** How the server looks at a blob: its length, its first six bytes, and its key ID. */
function isSealedRecord(blob: Uint8Array): boolean {
  return (
    blob.byteLength >= SEALED_RECORD_MIN &&
    blob.byteLength <= SEALED_RECORD_MAX &&
    sameBytes(blob.subarray(0, 6), SEALED_RECORD_START)
  );
}

/**
 * Stores a record only if the server has no copy of it, or its copy's
 * number is at or below the batch's cursor, and its chunks are not being
 * deleted. It gets the next number of its app.
 */
const STORE_RECORD = `
  INSERT INTO record (app, id, number, blob, mark, mark_time)
  SELECT ?1, unhex(?2), coalesce((SELECT max(number) FROM record WHERE app = ?1), 0) + 1, unhex(?3),
    ${MARK_NONE}, 0
  WHERE true
  ON CONFLICT (app, id) DO UPDATE SET
    number = excluded.number, blob = excluded.blob, mark = ${MARK_NONE}, mark_time = 0
  WHERE record.number <= ?4 AND NOT (record.mark = ${MARK_DELETING} AND record.mark_time >= ?5)`;

/** The row writes of the day: two for each record this batch stored, and three for the batch. */
const COUNT_DAY_WRITES = `
  INSERT INTO day_writes (one, day, writes)
  SELECT 1, ?1, 2 * n + 3 FROM (
    SELECT count(*) AS n FROM record
    WHERE app = ?2 AND number > coalesce((SELECT head FROM app WHERE name = ?2), 0)
  ) WHERE n > 0
  ON CONFLICT (one) DO UPDATE SET
    writes = CASE WHEN day_writes.day = excluded.day THEN day_writes.writes + excluded.writes
                  ELSE excluded.writes END,
    day = excluded.day`;

const MOVE_HEAD = `
  INSERT INTO app (name, head)
  SELECT ?1, m FROM (SELECT max(number) AS m FROM record WHERE app = ?1) WHERE m IS NOT NULL
  ON CONFLICT (name) DO UPDATE SET head = excluded.head WHERE excluded.head > app.head`;

const MOVE_TOLD = `
  INSERT INTO told (device, app, number)
  SELECT unhex(?1), ?2, head FROM app WHERE name = ?2
  ON CONFLICT (device, app) DO UPDATE SET number = excluded.number WHERE excluded.number > told.number`;

interface CopyState {
  number: number;
  mark: number;
  markTime: number;
}

/**
 * `POST /v1/changes`: a batch, stored in one step. Each record gets a
 * result, in order. The server never replaces a version with one whose
 * author had not seen it.
 */
export async function sendChanges(call: SignedCall): Promise<Uint8Array> {
  const { context, server, device, body, url } = call;
  const app = appName(readQuery(url, ["app"]).get("app"));
  const batch = readBatch(body);
  const count = batch.records.length;
  // A batch over a limit of info is 0C, but never a batch of one record.
  if (count > 1 && (count > MOST_RECORDS || batch.blobBytes > MOST_BYTES)) throw new Refusal(TOO_MUCH);
  if (!sameBytes(batch.epoch, server.epoch)) throw new Refusal(OTHER_EPOCH, server.epoch);
  const db = context.db;
  const now = context.now();
  const today = Math.floor(now / DAY_MS);
  const [toldResult, dayResult] = await run(db, [
    db.prepare("SELECT number FROM told WHERE device = unhex(?1) AND app = ?2").bind(device.id.toHex(), app),
    db.prepare("SELECT writes FROM day_writes WHERE one = 1 AND day = ?1").bind(today),
  ]);
  const told = Number(toldResult?.results[0]?.["number"] ?? 0);
  if (batch.known > told) throw await newEpoch(context, server);
  const dayWrites = Number(dayResult?.results[0]?.["writes"] ?? 0);
  if (batch.comparison && dayWrites + 2 * count + 3 > COMPARISON_DAY_WRITES) {
    throw new Refusal(WRITES_USED, Uint8Array.of(WRITES_USED_FOR_COMPARISON));
  }

  const results: number[] = [];
  const toStore: number[] = [];
  batch.records.forEach((record, index) => {
    if (!isSealedRecord(record.blob)) results[index] = NOT_A_SEALED_RECORD;
    else if (server.keyId === null || !sameBytes(record.blob.subarray(6, 10), server.keyId)) {
      results[index] = OTHER_KEY_ID;
    } else toStore.push(index);
  });
  const staleBefore = now - MARK_STALE_MS;
  const ids = JSON.stringify(toStore.map((index) => batch.records[index]!.id.toHex()));
  const written = await run(db, [
    serverUnchanged(db, server),
    deviceStillIn(db, device.id),
    db
      .prepare(
        `SELECT hex(id) AS id, number, mark, mark_time FROM record
         WHERE app = ?1 AND id IN (SELECT unhex(value) FROM json_each(?2))`,
      )
      .bind(app, ids),
    db.prepare("SELECT coalesce(max(number), 0) AS head FROM record WHERE app = ?1").bind(app),
    ...toStore.map((index) => {
      const record = batch.records[index]!;
      return db.prepare(STORE_RECORD).bind(app, record.id.toHex(), record.blob.toHex(), batch.cursor, staleBefore);
    }),
    db.prepare(COUNT_DAY_WRITES).bind(today, app),
    db.prepare(MOVE_HEAD).bind(app),
    db.prepare(MOVE_TOLD).bind(device.id.toHex(), app),
  ]);

  const copies = new Map<string, CopyState>();
  for (const row of written[2]?.results ?? []) {
    copies.set(String(row["id"]).toLowerCase(), {
      number: Number(row["number"]),
      mark: Number(row["mark"]),
      markTime: Number(row["mark_time"]),
    });
  }
  const headBefore = Number(written[3]?.results[0]?.["head"] ?? 0);
  const numbers: number[] = [];
  let head = headBefore;
  toStore.forEach((index, position) => {
    const key = batch.records[index]!.id.toHex();
    const copy = copies.get(key);
    const deleting = copy !== undefined && copy.mark === MARK_DELETING && copy.markTime >= staleBefore;
    const mayStore = copy === undefined || (copy.number <= batch.cursor && !deleting);
    const stored = (written[4 + position]?.meta.changes ?? 0) > 0;
    if (stored !== mayStore) throw new Error("the database and the rule disagree");
    if (stored) {
      head += 1;
      numbers[index] = head;
      const chunksWereDeleted =
        copy !== undefined && (copy.mark === MARK_DELETED || (copy.mark === MARK_DELETING && !deleting));
      results[index] = chunksWereDeleted ? STORED_SEND_STREAM_AGAIN : STORED;
      copies.set(key, { number: head, mark: MARK_NONE, markTime: 0 });
    } else {
      // The cursor is checked first: a copy that changed after it is 01,
      // also while its chunks are being deleted.
      results[index] = copy !== undefined && copy.number <= batch.cursor ? CHUNKS_BEING_DELETED : CHANGED_AFTER_CURSOR;
    }
  });

  const writer = new Writer().u8(DONE).bytes(server.epoch).i64(headBefore).i64(head).u32(count);
  results.forEach((result, index) => {
    writer.u8(result);
    if (result === STORED || result === STORED_SEND_STREAM_AGAIN) writer.i64(numbers[index]!);
  });
  return writer.finish();
}
