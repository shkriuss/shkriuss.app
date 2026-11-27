// File chunks: `files/send`, `files/have`, `files/fetch` and
// `files/delete`, and how a deletion and a record that brings the file
// back meet (sync-protocol.md, "Files" and `files/delete`). Tests point 6
// of "What the tests must cover".

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DONE,
  DOES_NOT_CHECK,
  MINUTE,
  TOO_MUCH,
  Writer,
  concat,
  hex,
  joinAnother,
  random,
  sealedRecord,
  send,
  serverInUse,
  sha256,
  signed,
  withServer,
} from "./harness.mjs";

const CHUNK = 4_194_304;

/** A stream in chunks, as a data app keeps it. */
function stream(length, chunkSize = CHUNK) {
  const bytes = random(length);
  const chunks = [];
  for (let offset = 0; offset < length; offset += chunkSize) chunks.push(bytes.subarray(offset, offset + chunkSize));
  return { fileId: random(16), hash: sha256(bytes), bytes, chunks };
}

async function sendChunks(server, setup, device, app, items) {
  const w = new Writer().u16(items.length);
  for (const item of items) {
    w.bytes(item.fileId).bytes(item.hash).u32(item.number).u32(item.bytes.length).bytes(item.chunkHash ?? sha256(item.bytes));
  }
  const signedPart = w.finish();
  const body = concat([signedPart, ...items.map((item) => item.bytes)]);
  const answer = await signed(server, setup.serverId, device, "POST", `/v1/files/send?app=${app}`, {
    body,
    signedPart,
  });
  return { ...answer, results: answer.answer === DONE ? [...answer.bytes.subarray(1)] : null };
}

function chunkItems(file, from = 0) {
  return file.chunks.slice(from).map((bytes, i) => ({ fileId: file.fileId, hash: file.hash, number: from + i, bytes }));
}

async function have(server, setup, device, app, files) {
  const w = new Writer().u16(files.length);
  for (const file of files) w.bytes(file.fileId).bytes(file.hash);
  const answer = await signed(server, setup.serverId, device, "POST", `/v1/files/have?app=${app}`, { body: w.finish() });
  if (answer.answer !== DONE) return answer;
  return { ...answer, counts: files.map(() => answer.reader.u32()) };
}

async function fetchChunks(server, setup, device, app, items) {
  const w = new Writer().u16(items.length);
  for (const item of items) w.bytes(item.fileId).bytes(item.hash).u32(item.number);
  const answer = await signed(server, setup.serverId, device, "POST", `/v1/files/fetch?app=${app}`, {
    body: w.finish(),
  });
  if (answer.answer !== DONE) return answer;
  const r = answer.reader;
  const lengths = items.map(() => (r.u8() === 0x00 ? r.u32() : null));
  return { ...answer, chunks: lengths.map((length) => (length === null ? null : r.take(length))) };
}

async function deleteFiles(server, setup, device, app, files, options = {}) {
  const w = new Writer().u16(files.length);
  for (const file of files) w.bytes(file.fileId).i64(file.number);
  const answer = await signed(server, setup.serverId, device, "POST", `/v1/files/delete?app=${app}`, {
    body: w.finish(),
    ...options,
  });
  return { ...answer, results: answer.answer === DONE ? [...answer.bytes.subarray(1)] : null };
}

/** Sends a file's record, deleted or not. Gives its result and number. */
async function sendRecord(server, setup, device, fileId, cursor, known = cursor) {
  const answer = await send(server, setup, device, "notes", {
    cursor,
    known,
    records: [{ id: fileId, blob: sealedRecord(setup.account.keyId) }],
  });
  return answer.results[0];
}

test("chunks are stored, counted from chunk 0, and fetched byte for byte", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const file = stream(2 * CHUNK + 10);
    const first = await sendChunks(server, setup, setup.device, "notes", chunkItems(file).slice(0, 1));
    assert.deepEqual(first.results, [0x00]);
    assert.equal(first.rowWrites, 0, "chunks cost no row write");
    assert.deepEqual((await have(server, setup, setup.device, "notes", [file])).counts, [1]);
    // Chunk 2 without chunk 1: counted from 0 without a gap.
    await sendChunks(server, setup, setup.device, "notes", chunkItems(file, 2));
    assert.deepEqual((await have(server, setup, setup.device, "notes", [file])).counts, [1]);
    await sendChunks(server, setup, setup.device, "notes", [chunkItems(file)[1]]);
    assert.deepEqual((await have(server, setup, setup.device, "notes", [file])).counts, [3]);
    const fetched = await fetchChunks(server, setup, setup.device, "notes", [chunkItems(file)[2]]);
    assert.deepEqual(hex(fetched.chunks[0]), hex(file.chunks[2]));
    const object = await (await server.files()).head(`notes/${hex(file.fileId)}/${hex(file.hash)}/0`);
    assert.equal(object.size, CHUNK, "one object for each chunk, named by app, file, stream hash and number");
  }));

test("many small files share one request, and a chunk whose hash does not fit is refused", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const files = Array.from({ length: 3 }, () => stream(100));
    const items = files.map((file) => chunkItems(file)[0]);
    items[1] = { ...items[1], chunkHash: random(32) };
    const answer = await sendChunks(server, setup, setup.device, "notes", items);
    assert.deepEqual(answer.results, [0x00, 0x01, 0x00]);
    assert.deepEqual((await have(server, setup, setup.device, "notes", files)).counts, [1, 0, 1]);
    const again = await sendChunks(server, setup, setup.device, "notes", [items[0]]);
    assert.deepEqual(again.results, [0x00], "storing the same chunk again changes nothing");
    const fetched = await fetchChunks(server, setup, setup.device, "notes", items);
    assert.deepEqual(
      fetched.chunks.map((c) => (c === null ? null : hex(c))),
      [hex(files[0].chunks[0]), null, hex(files[2].chunks[0])],
    );
  }));

test("a fetch of more than 4,194,304 bytes, or a send with more, is 0C", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const big = stream(CHUNK);
    const small = stream(1);
    await sendChunks(server, setup, setup.device, "notes", chunkItems(big));
    await sendChunks(server, setup, setup.device, "notes", chunkItems(small));
    const fetched = await fetchChunks(server, setup, setup.device, "notes", [chunkItems(big)[0], chunkItems(small)[0]]);
    assert.deepEqual([...fetched.bytes], [TOO_MUCH]);
    const both = await sendChunks(server, setup, setup.device, "notes", [chunkItems(big)[0], chunkItems(small)[0]]);
    assert.deepEqual([...both.bytes], [TOO_MUCH]);
  }));

test("file requests over 256 items, or of a wrong layout, do not check", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    for (const path of ["have", "fetch", "delete"]) {
      for (const count of [0, 257]) {
        const body = new Writer().u16(count).bytes(random(count * 48)).finish();
        const answer = await signed(server, setup.serverId, setup.device, "POST", `/v1/files/${path}?app=notes`, {
          body,
        });
        assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK], `${path} with ${count}`);
      }
      const cut = await signed(server, setup.serverId, setup.device, "POST", `/v1/files/${path}?app=notes`, {
        body: new Writer().u16(1).bytes(random(10)).finish(),
      });
      assert.deepEqual([...cut.bytes], [DOES_NOT_CHECK], `${path} cut`);
    }
    const file = stream(10);
    const item = chunkItems(file)[0];
    const w = new Writer().u16(1).bytes(item.fileId).bytes(item.hash).u32(0).u32(10).bytes(sha256(item.bytes));
    const signedPart = w.finish();
    const short = await signed(server, setup.serverId, setup.device, "POST", "/v1/files/send?app=notes", {
      body: concat([signedPart, item.bytes.subarray(0, 9)]),
      signedPart,
    });
    assert.deepEqual([...short.bytes], [DOES_NOT_CHECK], "fewer chunk bytes than the lengths say");
  }));

test("files/delete deletes the chunks while the deleted record is still the server's copy", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const file = stream(CHUNK + 5);
    await sendChunks(server, setup, setup.device, "notes", chunkItems(file));
    await sendRecord(server, setup, setup.device, file.fileId, 0);
    const deleted = await sendRecord(server, setup, setup.device, file.fileId, 1);
    assert.equal(deleted.number, 2);
    const answer = await deleteFiles(server, setup, setup.device, "notes", [{ fileId: file.fileId, number: 2 }]);
    assert.deepEqual(answer.results, [0x00]);
    assert.equal(answer.rowWrites, 2, "the mark, set and then changed");
    assert.deepEqual((await have(server, setup, setup.device, "notes", [file])).counts, [0]);
    const [row] = await server.sql("SELECT mark FROM record WHERE id = unhex(?1)", hex(file.fileId));
    assert.equal(row.mark, 2, "its chunks were deleted");
  }));

test("files/delete deletes nothing when another device stored a newer version since", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    const file = stream(50);
    await sendChunks(server, setup, setup.device, "notes", chunkItems(file));
    const deleted = await sendRecord(server, setup, setup.device, file.fileId, 0);
    // The other device saw the deleted record and brought the file back.
    await sendRecord(server, setup, other, file.fileId, 1, 0);
    const answer = await deleteFiles(server, setup, setup.device, "notes", [{ fileId: file.fileId, number: deleted.number }]);
    assert.deepEqual(answer.results, [0x01]);
    assert.equal(answer.rowWrites, 0);
    assert.deepEqual((await have(server, setup, setup.device, "notes", [file])).counts, [1]);
    const unknown = await deleteFiles(server, setup, setup.device, "notes", [{ fileId: random(16), number: 1 }]);
    assert.deepEqual(unknown.results, [0x01]);
  }));

test("while the chunks are being deleted, a record over it is 05; after, it is 04", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const file = stream(50);
    const deleted = await sendRecord(server, setup, setup.device, file.fileId, 0);
    // A deletion that is under way: its mark is set, its chunks still go.
    await server.sql("UPDATE record SET mark = 1, mark_time = ?1", server.now - 9 * MINUTE);
    assert.deepEqual(await sendRecord(server, setup, setup.device, file.fileId, deleted.number), { result: 0x05 });
    const [row] = await server.sql("SELECT number, mark FROM record");
    assert.deepEqual(row, { number: 1, mark: 1 }, "not stored");
    // The deletion ends.
    await server.sql("UPDATE record SET mark = 2");
    const back = await sendRecord(server, setup, setup.device, file.fileId, deleted.number);
    assert.deepEqual(back, { result: 0x04, number: 2 });
    const [after] = await server.sql("SELECT mark FROM record");
    assert.equal(after.mark, 0, "the mark is taken off");
  }));

test("a deletion that was cut off after its mark: a record is stored over it once the mark is 10 minutes old", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const file = stream(50);
    await sendChunks(server, setup, setup.device, "notes", chunkItems(file));
    const deleted = await sendRecord(server, setup, setup.device, file.fileId, 0);
    await server.sql("UPDATE record SET mark = 1, mark_time = ?1", server.now - 10 * MINUTE - 1);
    // Asking again finishes it.
    const answer = await deleteFiles(server, setup, setup.device, "notes", [{ fileId: file.fileId, number: deleted.number }]);
    assert.deepEqual(answer.results, [0x00]);
    assert.deepEqual((await have(server, setup, setup.device, "notes", [file])).counts, [0]);
    // Or, cut off again, a record that brings the file back is stored with 04.
    await server.sql("UPDATE record SET mark = 1, mark_time = ?1", server.now - 10 * MINUTE - 1);
    assert.deepEqual(await sendRecord(server, setup, setup.device, file.fileId, deleted.number), {
      result: 0x04,
      number: 2,
    });
  }));

test("asking again: after the end nothing is deleted again; while it runs, 02", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const file = stream(50);
    const deleted = await sendRecord(server, setup, setup.device, file.fileId, 0);
    await deleteFiles(server, setup, setup.device, "notes", [{ fileId: file.fileId, number: deleted.number }]);
    // A device sent the chunks again, ahead of its record.
    await sendChunks(server, setup, setup.device, "notes", chunkItems(file));
    const again = await deleteFiles(server, setup, setup.device, "notes", [{ fileId: file.fileId, number: deleted.number }]);
    assert.deepEqual(again.results, [0x00]);
    assert.equal(again.rowWrites, 0);
    assert.deepEqual((await have(server, setup, setup.device, "notes", [file])).counts, [1], "nothing deleted again");
    await server.sql("UPDATE record SET mark = 1, mark_time = ?1", server.now - 10 * MINUTE);
    const running = await deleteFiles(server, setup, setup.device, "notes", [{ fileId: file.fileId, number: deleted.number }]);
    assert.deepEqual(running.results, [0x02]);
    assert.equal(running.rowWrites, 0);
  }));

test("a request deletes no chunk later than 5 minutes after it set its mark", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const files = [stream(50), stream(50)];
    for (const file of files) await sendChunks(server, setup, setup.device, "notes", chunkItems(file));
    const numbers = [];
    for (const [i, file] of files.entries()) numbers.push((await sendRecord(server, setup, setup.device, file.fileId, i)).number);
    // The clock moves on by 2 minutes at each look of the server. The mark
    // is set at the third look (minute 4), so the deadline is minute 9: the
    // first file's chunks go at minutes 6 and 8, the second's would at 10.
    const answer = await deleteFiles(
      server,
      setup,
      setup.device,
      "notes",
      files.map((file, i) => ({ fileId: file.fileId, number: numbers[i] })),
      { headers: { "shk-test-tick": String(2 * MINUTE) } },
    );
    assert.equal(answer.answer, DONE);
    assert.deepEqual(answer.results, [0x00, 0x02]);
    const [second] = await server.sql("SELECT mark FROM record WHERE id = unhex(?1)", hex(files[1].fileId));
    assert.equal(second.mark, 1, "its mark stays, and is good for nothing after 10 minutes");
    assert.deepEqual((await have(server, setup, setup.device, "notes", [files[1]])).counts, [1]);
  }));

test("a file request of more items than info names, 128, is 0C", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    for (const [path, size] of [
      ["have", 48],
      ["fetch", 52],
      ["delete", 24],
    ]) {
      const body = new Writer().u16(129).bytes(random(129 * size)).finish();
      const answer = await signed(server, setup.serverId, setup.device, "POST", `/v1/files/${path}?app=notes`, { body });
      assert.deepEqual([...answer.bytes], [TOO_MUCH], path);
    }
    const files = Array.from({ length: 129 }, () => stream(1));
    const send = await sendChunks(server, setup, setup.device, "notes", files.map((file) => chunkItems(file)[0]));
    assert.deepEqual([...send.bytes], [TOO_MUCH], "send");
  }));

test("files/have counts 128 files of Notes' largest size, 6 chunks each, in one request", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const bucket = await server.files();
    const files = Array.from({ length: 128 }, () => ({ fileId: random(16), hash: random(32) }));
    for (const file of files) {
      for (let chunk = 0; chunk < 6; chunk++) {
        await bucket.put(`notes/${hex(file.fileId)}/${hex(file.hash)}/${chunk}`, "x");
      }
    }
    const answer = await have(server, setup, setup.device, "notes", files);
    assert.equal(answer.answer, DONE);
    assert.deepEqual(answer.counts, Array(128).fill(6));
  }));

test("files/fetch gives many chunks of one request, each read before the next is asked for", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const files = Array.from({ length: 12 }, () => stream(1000));
    await sendChunks(server, setup, setup.device, "notes", files.map((file) => chunkItems(file)[0]));
    const fetched = await fetchChunks(server, setup, setup.device, "notes", files.map((file) => chunkItems(file)[0]));
    assert.equal(fetched.answer, DONE);
    assert.deepEqual(
      fetched.chunks.map((c) => hex(c)),
      files.map((file) => hex(file.chunks[0])),
    );
  }));
