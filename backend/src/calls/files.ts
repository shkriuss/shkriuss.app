// File chunks in R2 (sync-protocol.md: `files/send`, `files/have`,
// `files/fetch`, `files/delete`, "Files"). A chunk is one object, named by
// the app, the file ID, the stream's hash and the chunk's number. The
// Worker never hashes a chunk: R2 checks the SHA-256 that comes with it.

import { DONE, Refusal, TOO_MUCH } from "../answers";
import { LayoutError, Reader, Writer } from "../bytes";
import type { SignedCall } from "../call";
import {
  CHUNK_BYTES,
  DELETE_DEADLINE_MS,
  FORMAT_MOST_FILE_ITEMS,
  MARK_STALE_MS,
  MOST_FILE_ITEMS,
  R2_CALLS,
} from "../limits";
import { appName, readQuery } from "../request";
import {
  MARK_DELETED,
  MARK_DELETING,
  deviceStillIn,
  run,
  serverUnchanged,
  type Context,
} from "../store";

const CHUNK_DESCRIPTION = 88;

/** The name of a chunk's object in R2. */
function chunkKey(app: string, fileId: Uint8Array, streamHash: Uint8Array, chunk: number): string {
  return `${app}/${fileId.toHex()}/${streamHash.toHex()}/${chunk}`;
}

/** Reads the count of a file request: 1 to 256 by the format, `0C` above what `info` names. */
function readCount(reader: Reader): number {
  const count = reader.u16();
  if (count < 1 || count > FORMAT_MOST_FILE_ITEMS) throw new LayoutError("count");
  if (count > MOST_FILE_ITEMS) throw new Refusal(TOO_MUCH);
  return count;
}

/** Counts the calls to R2 of one request, and stops at the limit with `0C`. */
class R2Calls {
  private used = 0;

  take(): void {
    this.used += 1;
    if (this.used > R2_CALLS) throw new Refusal(TOO_MUCH);
  }

  get left(): number {
    return R2_CALLS - this.used;
  }
}

/** The part of a `files/send` body that the signature covers: everything before the chunks. */
export function filesSendSignedPart(body: Uint8Array): Uint8Array {
  const reader = new Reader(body);
  const count = reader.u16();
  return body.subarray(0, 2 + CHUNK_DESCRIPTION * count);
}

/** `POST /v1/files/send`: stores chunks. Each is `00` stored, or `01` its hash did not fit. */
export async function filesSend(call: SignedCall): Promise<Uint8Array> {
  const { context, body, url } = call;
  const app = appName(readQuery(url, ["app"]).get("app"));
  const reader = new Reader(body);
  const count = readCount(reader);
  const chunks: { key: string; length: number; hash: Uint8Array }[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const fileId = reader.take(16);
    const streamHash = reader.take(32);
    const number = reader.u32();
    const length = reader.u32();
    const hash = reader.take(32);
    if (length < 1) throw new LayoutError("empty chunk");
    chunks.push({ key: chunkKey(app, fileId, streamHash, number), length, hash });
    total += length;
  }
  if (total > CHUNK_BYTES) throw new Refusal(TOO_MUCH);
  if (reader.remaining !== total) throw new LayoutError("chunk bytes");
  const writer = new Writer().u8(DONE);
  for (const chunk of chunks) {
    const bytes = reader.take(chunk.length);
    writer.u8(await putChunk(context, chunk.key, bytes, chunk.hash));
  }
  return writer.finish();
}

async function putChunk(context: Context, key: string, bytes: Uint8Array, hash: Uint8Array): Promise<number> {
  try {
    await context.files.put(key, bytes, { sha256: hash.slice().buffer });
    return 0x00;
  } catch (error) {
    // R2's error 10037: the SHA-256 that came with the chunk does not fit it.
    const message = error instanceof Error ? error.message : "";
    if (message.includes("(10037)") || message.includes("SHA-256 checksum")) return 0x01;
    throw error;
  }
}

/**
 * `POST /v1/files/have`: for each stream, how many of its chunks the
 * server has, counted from chunk 0 without a gap. Each chunk asked is one
 * reading operation of R2.
 */
export async function filesHave(call: SignedCall): Promise<Uint8Array> {
  const { context, body, url } = call;
  const app = appName(readQuery(url, ["app"]).get("app"));
  const reader = new Reader(body);
  const count = readCount(reader);
  const streams: { fileId: Uint8Array; streamHash: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) streams.push({ fileId: reader.take(16), streamHash: reader.take(32) });
  reader.end();
  const calls = new R2Calls();
  const writer = new Writer().u8(DONE);
  for (const stream of streams) {
    let have = 0;
    for (;;) {
      calls.take();
      const object = await context.files.head(chunkKey(app, stream.fileId, stream.streamHash, have));
      if (object === null) break;
      have += 1;
    }
    writer.u32(have);
  }
  return writer.finish();
}

/**
 * `POST /v1/files/fetch`: the chunks a device asks for, at most 4,194,304
 * bytes together. A request for more is `0C`.
 */
export async function filesFetch(call: SignedCall): Promise<Uint8Array> {
  const { context, body, url } = call;
  const app = appName(readQuery(url, ["app"]).get("app"));
  const reader = new Reader(body);
  const count = readCount(reader);
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    keys.push(chunkKey(app, reader.take(16), reader.take(32), reader.u32()));
  }
  reader.end();
  // Each chunk is read whole before the next is asked for. A Worker keeps
  // only six connections open at once, R2's among them, so open bodies
  // must not pile up.
  const chunks: (Uint8Array | null)[] = [];
  let total = 0;
  for (const key of keys) {
    const object = await context.files.get(key);
    if (object === null) {
      chunks.push(null);
      continue;
    }
    total += object.size;
    if (total > CHUNK_BYTES) {
      await object.body.cancel();
      throw new Refusal(TOO_MUCH);
    }
    chunks.push(new Uint8Array(await object.arrayBuffer()));
  }
  const writer = new Writer().u8(DONE);
  for (const chunk of chunks) {
    if (chunk === null) writer.u8(0x01);
    else writer.u8(0x00).u32(chunk.byteLength);
  }
  for (const chunk of chunks) {
    if (chunk !== null) writer.bytes(chunk);
  }
  return writer.finish();
}

/** One file of a `files/delete`, and what became of it. */
interface Deletion {
  readonly fileId: Uint8Array;
  readonly number: number;
  result: number;
  /** Set when this request set the mark "its chunks are being deleted". */
  markTime: number | null;
}

const DELETED = 0x00;
const NOT_DELETED = 0x01;
const NOT_NOW = 0x02;

/**
 * `POST /v1/files/delete`: deletes a file's chunks, but only while the
 * server's copy of the file's record still has the number the device's
 * batch stored it under. The mark "its chunks are being deleted" is set
 * before any chunk goes, so that no record is stored over it meanwhile.
 */
export async function filesDelete(call: SignedCall): Promise<Uint8Array> {
  const { context, server, device, body, url } = call;
  const app = appName(readQuery(url, ["app"]).get("app"));
  const reader = new Reader(body);
  const count = readCount(reader);
  const files: Deletion[] = [];
  for (let i = 0; i < count; i++) {
    files.push({ fileId: reader.take(16), number: reader.count64(), result: NOT_DELETED, markTime: null });
  }
  reader.end();
  const db = context.db;
  const now = context.now();
  const staleBefore = now - MARK_STALE_MS;

  // 1. In one step: check each record and set the mark.
  const ids = JSON.stringify(files.map((file) => file.fileId.toHex()));
  const marked = await run(db, [
    serverUnchanged(db, server),
    deviceStillIn(db, device.id),
    db
      .prepare(
        `SELECT hex(id) AS id, number, mark, mark_time FROM record
         WHERE app = ?1 AND id IN (SELECT unhex(value) FROM json_each(?2))`,
      )
      .bind(app, ids),
    ...files.map((file) =>
      db
        .prepare(
          `UPDATE record SET mark = ${MARK_DELETING}, mark_time = ?4
           WHERE app = ?1 AND id = unhex(?2) AND number = ?3
             AND (mark = 0 OR (mark = ${MARK_DELETING} AND mark_time < ?5))`,
        )
        .bind(app, file.fileId.toHex(), file.number, now, staleBefore),
    ),
  ]);
  const copies = new Map<string, { number: number; mark: number; markTime: number }>();
  for (const row of marked[2]?.results ?? []) {
    copies.set(String(row["id"]).toLowerCase(), {
      number: Number(row["number"]),
      mark: Number(row["mark"]),
      markTime: Number(row["mark_time"]),
    });
  }
  files.forEach((file, position) => {
    const key = file.fileId.toHex();
    const copy = copies.get(key);
    const setMark = (marked[3 + position]?.meta.changes ?? 0) > 0;
    if (copy === undefined || copy.number !== file.number) file.result = NOT_DELETED;
    else if (copy.mark === MARK_DELETED) file.result = DELETED;
    else if (copy.mark === MARK_DELETING && copy.markTime >= staleBefore) file.result = NOT_NOW;
    else file.markTime = now;
    if (setMark !== (file.markTime !== null)) throw new Error("the database and the rule disagree");
    if (setMark) copies.set(key, { number: file.number, mark: MARK_DELETING, markTime: now });
  });

  // 2. Delete the chunks, at most until 5 minutes after the mark was set.
  const calls = new R2Calls();
  const deadline = now + DELETE_DEADLINE_MS;
  const finished: Deletion[] = [];
  for (const file of files) {
    if (file.markTime === null) continue;
    if (await deleteChunks(context, `${app}/${file.fileId.toHex()}/`, deadline, calls)) finished.push(file);
    else file.result = NOT_NOW;
  }

  // 3. In one step, change each mark to "its chunks were deleted", if it
  //    is still the one this request set.
  if (finished.length > 0) {
    await run(
      db,
      finished.map((file) =>
        db
          .prepare(
            `UPDATE record SET mark = ${MARK_DELETED}
             WHERE app = ?1 AND id = unhex(?2) AND number = ?3 AND mark = ${MARK_DELETING} AND mark_time = ?4`,
          )
          .bind(app, file.fileId.toHex(), file.number, file.markTime),
      ),
    );
    for (const file of finished) file.result = DELETED;
  }
  const writer = new Writer().u8(DONE);
  for (const file of files) writer.u8(file.result);
  return writer.finish();
}

/**
 * Deletes every object under a prefix. Gives false, with the rest left,
 * if the deadline or the limit of R2 calls comes first.
 */
async function deleteChunks(context: Context, prefix: string, deadline: number, calls: R2Calls): Promise<boolean> {
  let cursor: string | undefined;
  do {
    if (context.now() > deadline || calls.left < 2) return false;
    calls.take();
    const listing = await context.files.list(cursor === undefined ? { prefix } : { prefix, cursor });
    const keys = listing.objects.map((object) => object.key);
    if (keys.length > 0) {
      if (context.now() > deadline) return false;
      calls.take();
      await context.files.delete(keys);
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor !== undefined);
  return true;
}

