// Sending and fetching records (sync-protocol.md: "Send", "Fetch",
// "Numbers, cursors and the epoch"). Tests points 3, 4, 5, 7 and 10 of
// "What the tests must cover".

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAY,
  DOES_NOT_CHECK,
  DONE,
  OTHER_EPOCH,
  TOO_MUCH,
  WRITES_USED,
  batchBody,
  fetchPage,
  hex,
  joinAnother,
  random,
  readHeads,
  sealedRecord,
  send,
  serverInUse,
  signed,
  withServer,
} from "./harness.mjs";

const STORED = 0x00;
const CHANGED = 0x01;
const OTHER_KEY = 0x02;
const NOT_SEALED = 0x03;

function record(setup, length) {
  return { id: random(16), blob: sealedRecord(setup.account.keyId, length) };
}

test("a batch is stored with numbers above the head, in its order", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const records = [record(setup), record(setup), record(setup)];
    const answer = await send(server, setup, setup.device, "water", { records });
    assert.equal(answer.answer, DONE);
    assert.deepEqual(answer.epoch, setup.epoch);
    assert.equal(answer.headBefore, 0);
    assert.equal(answer.headAfter, 3);
    assert.deepEqual(answer.results, [
      { result: STORED, number: 1 },
      { result: STORED, number: 2 },
      { result: STORED, number: 3 },
    ]);
    const page = await fetchPage(server, setup, setup.device, "water");
    assert.equal(page.answer, DONE);
    assert.equal(page.through, 3);
    assert.equal(page.more, 0);
    assert.deepEqual(
      page.records.map((r) => [hex(r.id), r.number, hex(r.blob)]),
      records.map((r, i) => [hex(r.id), i + 1, hex(r.blob)]),
    );
  }));

test("a batch of one record costs five row writes, and each more record two", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const one = await send(server, setup, setup.device, "water", { records: [record(setup)] });
    assert.equal(one.rowWrites, 5);
    const ten = await send(server, setup, setup.device, "water", {
      cursor: 1,
      known: 1,
      records: Array.from({ length: 10 }, () => record(setup)),
    });
    assert.equal(ten.rowWrites, 2 * 10 + 3);
  }));

test("a stored record replaces the copy only if the copy is at or below the batch's cursor", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    const first = record(setup);
    await send(server, setup, setup.device, "water", { records: [first, record(setup)] });
    // The other device saw everything up to 2 and changes the first record.
    const newer = { id: first.id, blob: sealedRecord(setup.account.keyId) };
    const fromOther = await send(server, setup, other, "water", { cursor: 2, records: [newer] });
    assert.deepEqual(fromOther.results, [{ result: STORED, number: 3 }]);
    // The first device had seen only up to 2 too, but the copy changed after it.
    const stale = { id: first.id, blob: sealedRecord(setup.account.keyId) };
    const fromFirst = await send(server, setup, setup.device, "water", { cursor: 2, known: 2, records: [stale] });
    assert.deepEqual(fromFirst.results, [{ result: CHANGED }]);
    assert.equal(fromFirst.headAfter, 3);
    const page = await fetchPage(server, setup, setup.device, "water", { since: 2, known: 2 });
    assert.deepEqual(hex(page.records[0].blob), hex(newer.blob), "the newer version stays");
  }));

test("a stored record moves to the end of the order with a new number", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const a = record(setup);
    const b = record(setup);
    await send(server, setup, setup.device, "water", { records: [a, b] });
    const again = await send(server, setup, setup.device, "water", {
      cursor: 2,
      known: 2,
      records: [{ id: a.id, blob: sealedRecord(setup.account.keyId) }],
    });
    assert.deepEqual(again.results, [{ result: STORED, number: 3 }]);
    assert.equal(again.rowWrites, 5, "two for the record, also when it replaces a copy");
    const page = await fetchPage(server, setup, setup.device, "water");
    assert.deepEqual(
      page.records.map((r) => [hex(r.id), r.number]),
      [
        [hex(b.id), 2],
        [hex(a.id), 3],
      ],
    );
  }));

test("a blob that is not a sealed record is 03, and one of another key ID is 02, each in its place", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const short = { id: random(16), blob: sealedRecord(setup.account.keyId, 49) };
    const wrongStart = { id: random(16), blob: random(80) };
    const otherKey = { id: random(16), blob: sealedRecord(random(4)) };
    const good = record(setup);
    const smallest = record(setup, 50);
    const answer = await send(server, setup, setup.device, "water", {
      records: [short, good, wrongStart, otherKey, smallest],
    });
    assert.deepEqual(answer.results, [
      { result: NOT_SEALED },
      { result: STORED, number: 1 },
      { result: NOT_SEALED },
      { result: OTHER_KEY },
      { result: STORED, number: 2 },
    ]);
  }));

test("one record of 524,288 bytes always fits, in a batch and in a page", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const big = record(setup, 524_288);
    const answer = await send(server, setup, setup.device, "notes", { records: [big] });
    assert.deepEqual(answer.results, [{ result: STORED, number: 1 }]);
    const tooBig = await send(server, setup, setup.device, "notes", {
      records: [record(setup, 524_289)],
    });
    assert.deepEqual(tooBig.results, [{ result: NOT_SEALED }]);
    await send(server, setup, setup.device, "notes", { cursor: 2, known: 1, records: [record(setup)] });
    const page = await fetchPage(server, setup, setup.device, "notes", { most: 100 });
    assert.equal(page.records.length, 1, "the big record alone, the page is cut after it");
    assert.equal(page.records[0].blob.length, 524_288);
    assert.deepEqual(hex(page.records[0].blob), hex(big.blob));
    assert.equal(page.through, 1);
    assert.equal(page.more, 1);
  }));

test("a batch over the limits of info is 0C, but never a batch of one record", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const many = await send(server, setup, setup.device, "water", {
      records: [record(setup, 300_000), record(setup, 300_000)],
    });
    assert.deepEqual([...many.bytes], [TOO_MUCH]);
    const hundred = await send(server, setup, setup.device, "water", {
      records: Array.from({ length: 100 }, () => record(setup, 60)),
    });
    assert.equal(hundred.answer, DONE);
  }));

test("batches that are cut, too long or of a wrong layout do not check", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const good = batchBody({ epoch: setup.epoch, records: [record(setup)] });
    const noRecords = batchBody({ epoch: setup.epoch, records: [] });
    const tooMany = batchBody({
      epoch: setup.epoch,
      records: Array.from({ length: 101 }, () => record(setup, 50)),
    });
    const kind = good.slice();
    kind[32] = 0x02;
    const negative = good.slice();
    negative[16] = 0x80;
    const bodies = {
      cut: good.subarray(0, good.length - 1),
      "too long": new Uint8Array([...good, 0]),
      "no records": noRecords,
      "101 records": tooMany,
      "another kind of batch": kind,
      "a negative cursor": negative,
    };
    for (const [name, body] of Object.entries(bodies)) {
      const answer = await signed(server, setup.serverId, setup.device, "POST", "/v1/changes?app=water", { body });
      assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK], name);
      assert.equal(answer.rowWrites, 0, name);
    }
    for (const query of ["", "?app=Water", "?app=water&app=water", "?app=water&x=1", "?app=" + "a".repeat(33)]) {
      const answer = await signed(server, setup.serverId, setup.device, "POST", `/v1/changes${query}`, {
        body: good,
      });
      assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK], query);
    }
  }));

test("a page holds at most `most` records and says whether more wait", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    await send(server, setup, setup.device, "water", {
      records: Array.from({ length: 5 }, () => record(setup)),
    });
    const first = await fetchPage(server, setup, setup.device, "water", { most: 2 });
    assert.deepEqual(
      first.records.map((r) => r.number),
      [1, 2],
    );
    assert.equal(first.since, 0);
    assert.equal(first.through, 2);
    assert.equal(first.more, 1);
    const last = await fetchPage(server, setup, setup.device, "water", { since: 4, known: 2, most: 2 });
    assert.deepEqual(
      last.records.map((r) => r.number),
      [5],
    );
    assert.equal(last.through, 5);
    assert.equal(last.more, 0);
    const exact = await fetchPage(server, setup, setup.device, "water", { since: 3, known: 5, most: 2 });
    assert.equal(exact.through, 5, "a page that holds exactly the rest is not cut");
    assert.equal(exact.more, 0);
    const empty = await fetchPage(server, setup, setup.device, "water", { since: 5, known: 5 });
    assert.equal(empty.records.length, 0);
    assert.equal(empty.through, 5);
    assert.equal(empty.more, 0);
  }));

test("a page is cut where its blobs pass the byte limit of info", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    for (let i = 0; i < 3; i++) {
      await send(server, setup, setup.device, "notes", { cursor: i, known: i, records: [record(setup, 200_000)] });
    }
    const page = await fetchPage(server, setup, setup.device, "notes", { known: 3 });
    assert.deepEqual(
      page.records.map((r) => r.number),
      [1, 2],
    );
    assert.equal(page.through, 2);
    assert.equal(page.more, 1);
  }));

test("an app the server does not know has the head 0 and an empty page", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const page = await fetchPage(server, setup, setup.device, "tasks");
    assert.equal(page.answer, DONE);
    assert.equal(page.through, 0);
    assert.equal(page.records.length, 0);
    assert.equal(page.rowWrites, 0, "nothing told, nothing written");
  }));

test("a page costs one row write when it tells the device more than before, else none", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    await send(server, setup, setup.device, "water", { records: [record(setup)] });
    const first = await fetchPage(server, setup, other, "water");
    assert.equal(first.rowWrites, 1);
    const again = await fetchPage(server, setup, other, "water", { known: 1 });
    assert.equal(again.rowWrites, 0);
  }));

test("Through is read with the page: a record stored between two fetches is never below it", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    await send(server, setup, setup.device, "water", {
      records: Array.from({ length: 4 }, () => record(setup)),
    });
    const first = await fetchPage(server, setup, other, "water", { most: 2 });
    await send(server, setup, setup.device, "water", { cursor: 4, known: 4, records: [record(setup)] });
    const second = await fetchPage(server, setup, other, "water", { since: first.through, known: first.through });
    const numbers = [...first.records, ...second.records].map((r) => r.number);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5], "no gap and nothing twice");
    assert.equal(second.through, 5);
  }));

test("a request with another epoch gets the server's epoch, and no new epoch is made", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const wrong = random(16);
    const page = await fetchPage(server, setup, setup.device, "water", { epoch: wrong });
    assert.equal(page.answer, OTHER_EPOCH);
    assert.deepEqual(page.reader.take(16), setup.epoch);
    const batch = await send(server, setup, setup.device, "water", { epoch: wrong, records: [record(setup)] });
    assert.equal(batch.answer, OTHER_EPOCH);
    assert.deepEqual(batch.reader.take(16), setup.epoch);
    assert.equal(batch.rowWrites, 0);
    const heads = await readHeads(server, setup, setup.device);
    assert.deepEqual(heads.epoch, setup.epoch);
  }));

test("a device that knows more than the server told it makes a new epoch", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    await send(server, setup, setup.device, "water", {
      records: Array.from({ length: 3 }, () => record(setup)),
    });
    const page = await fetchPage(server, setup, other, "water");
    assert.equal(page.through, 3);
    // The user puts the database back to a day when the server had told
    // the other device only 1.
    await server.sql("UPDATE told SET number = 1");
    const after = await fetchPage(server, setup, other, "water", { since: 3, known: 3 });
    assert.equal(after.answer, OTHER_EPOCH);
    assert.equal(after.rowWrites, 3, "the server's row, and the two rows of what it told the devices");
    const epoch = after.reader.take(16);
    assert.notDeepEqual(epoch, setup.epoch);
    const heads = await readHeads(server, { ...setup, epoch }, setup.device);
    assert.deepEqual(heads.epoch, epoch, "the new epoch is the server's now");
    assert.equal(heads.apps.water.told, 0, "the server forgot what it told every device");
    // A batch shows it in the same way.
    await server.sql("UPDATE told SET number = 0");
    const batch = await send(server, { ...setup, epoch }, setup.device, "water", {
      cursor: 3,
      known: 3,
      records: [record(setup)],
    });
    assert.equal(batch.answer, OTHER_EPOCH);
    assert.notDeepEqual(batch.reader.take(16), epoch);
  }));

test("a database put back and filled again to the same head is still found, through heads", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    await send(server, setup, setup.device, "water", {
      records: Array.from({ length: 3 }, () => record(setup)),
    });
    await fetchPage(server, setup, other, "water");
    // Put back to before the last record and before the fetch, then
    // filled again by the first device to the same head.
    await server.sql("DELETE FROM record WHERE number = 3");
    await server.sql("UPDATE app SET head = 2");
    await server.sql("UPDATE told SET number = 2 WHERE device = unhex(?1)", hex(setup.device.id));
    await server.sql("DELETE FROM told WHERE device = unhex(?1)", hex(other.id));
    await send(server, setup, setup.device, "water", { cursor: 2, known: 2, records: [record(setup)] });
    const heads = await readHeads(server, setup, other);
    assert.equal(heads.apps.water.head, 3, "the head is the one the other device saw");
    assert.equal(heads.apps.water.told, 0, "but the server says it told that device less than its Known, 3");
  }));

test("heads names each app with its head and what the server told this device", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    await send(server, setup, setup.device, "water", { records: [record(setup), record(setup)] });
    await send(server, setup, setup.device, "notes", { records: [record(setup)] });
    const heads = await readHeads(server, setup, setup.device);
    assert.deepEqual(heads.apps, { notes: { head: 1, told: 1 }, water: { head: 2, told: 2 } });
    assert.equal(heads.reader.remaining, 0);
    assert.equal(heads.rowWrites, 0);
  }));

test("a batch of a comparison of everything is stopped for the day at 70,000 row writes", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const today = Math.floor(server.now / DAY);
    await server.sql("INSERT INTO day_writes (one, day, writes) VALUES (1, ?1, 69990)", today);
    const records = Array.from({ length: 4 }, () => record(setup));
    const comparison = await send(server, setup, setup.device, "water", { comparison: true, records });
    assert.deepEqual([...comparison.bytes], [WRITES_USED, 0x01]);
    assert.equal(comparison.rowWrites, 0);
    const ordinary = await send(server, setup, setup.device, "water", { records });
    assert.equal(ordinary.answer, DONE, "ordinary changes still get through");
    const [row] = await server.sql("SELECT day, writes FROM day_writes");
    assert.deepEqual(row, { day: today, writes: 69990 + 2 * 4 + 3 });
    server.now += DAY;
    const nextDay = await send(server, setup, setup.device, "water", {
      cursor: 4,
      known: 4,
      comparison: true,
      records: [record(setup)],
    });
    assert.equal(nextDay.answer, DONE, "the next day starts at 0");
    const [next] = await server.sql("SELECT day, writes FROM day_writes");
    assert.deepEqual(next, { day: today + 1, writes: 5 });
  }));

test("fetch queries that are not of their layout do not check", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const e = hex(setup.epoch);
    for (const query of [
      `app=water&since=0&known=0&epoch=${e}`,
      `app=water&since=0&known=0&epoch=${e}&most=0`,
      `app=water&since=0&known=0&epoch=${e}&most=101`,
      `app=water&since=-1&known=0&epoch=${e}&most=1`,
      `app=water&since=0&known=0&epoch=${e.toUpperCase()}&most=1`,
      `app=water&since=0&known=0&epoch=${e.slice(2)}&most=1`,
      `app=water&since=0&since=0&known=0&epoch=${e}&most=1`,
    ]) {
      const answer = await signed(server, setup.serverId, setup.device, "GET", `/v1/changes?${query}`);
      assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK], query);
    }
    const anyOrder = await signed(
      server,
      setup.serverId,
      setup.device,
      "GET",
      `/v1/changes?most=5&epoch=${e}&known=0&since=0&app=water`,
    );
    assert.equal(anyOrder.answer, DONE, "the names may come in any order");
  }));

test("the same record twice in one batch: the first is stored, the second finds a copy newer than the cursor", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const id = random(16);
    const answer = await send(server, setup, setup.device, "water", {
      records: [
        { id, blob: sealedRecord(setup.account.keyId) },
        { id, blob: sealedRecord(setup.account.keyId) },
      ],
    });
    assert.deepEqual(answer.results, [{ result: STORED, number: 1 }, { result: CHANGED }]);
    assert.equal(answer.headAfter, 1);
  }));

test("the cap of a comparison counts the records the batch stores, in the same step", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    const old = Array.from({ length: 3 }, () => record(setup));
    await send(server, setup, setup.device, "water", { records: old });
    const today = Math.floor(server.now / DAY);
    await server.sql("UPDATE day_writes SET writes = 69990");
    // Three of four are refused: their copies changed after the cursor 0.
    // The one that is stored writes 2 + 3 rows, so the day ends at 69,995.
    const mixed = await send(server, setup, other, "water", {
      comparison: true,
      records: [...old.map((r) => ({ id: r.id, blob: sealedRecord(setup.account.keyId) })), record(setup)],
    });
    assert.equal(mixed.answer, DONE);
    assert.deepEqual(
      mixed.results.map((r) => r.result),
      [CHANGED, CHANGED, CHANGED, STORED],
    );
    assert.deepEqual(await server.sql("SELECT day, writes FROM day_writes"), [{ day: today, writes: 69995 }]);
    const toTheCap = await send(server, setup, other, "water", {
      cursor: 4,
      known: 4,
      comparison: true,
      records: [record(setup)],
    });
    assert.equal(toTheCap.answer, DONE, "70,000 is not past the cap");
    const past = await send(server, setup, other, "water", {
      cursor: 5,
      known: 5,
      comparison: true,
      records: [record(setup)],
    });
    assert.deepEqual([...past.bytes], [WRITES_USED, 0x01]);
    assert.equal(past.rowWrites, 0, "nothing of it was written");
    assert.deepEqual(await server.sql("SELECT day, writes FROM day_writes"), [{ day: today, writes: 70000 }]);
    const refusedOnly = await send(server, setup, other, "water", {
      cursor: 0,
      known: 5,
      comparison: true,
      records: [{ id: old[0].id, blob: sealedRecord(setup.account.keyId) }],
    });
    assert.equal(refusedOnly.answer, DONE, "a comparison that stores nothing writes nothing, and is answered");
    assert.deepEqual(refusedOnly.results, [{ result: CHANGED }]);
  }));
