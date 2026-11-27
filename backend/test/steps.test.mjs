// What happens when another request changes the server between two steps
// of a call. The test Worker runs SQL just before a given D1 batch of the
// request, as another request would. In these tests the device was
// already seen that day, so a call's first batch reads the server's row,
// and its next batches are the call's own.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DONE,
  OTHER_EPOCH,
  REMOVED,
  fetchPage,
  hex,
  joinAnother,
  random,
  sealedRecord,
  send,
  serverInUse,
  signed,
  withServer,
} from "./harness.mjs";

function between(at, ...sql) {
  return { "shk-test-sql-at": String(at), "shk-test-sql": JSON.stringify(sql) };
}

function anotherSend(number) {
  return [
    `INSERT INTO record (app, id, number, blob, mark, mark_time)
     VALUES ('water', randomblob(16), ${number}, x'53484b010101' || randomblob(100), 0, 0)`,
    `UPDATE app SET head = ${number} WHERE name = 'water'`,
  ];
}

test("a record stored at any step of a fetch is fetched once, never skipped", async () => {
  for (const at of [2, 3]) {
    await withServer(async (server) => {
      const setup = await serverInUse(server);
      const other = await joinAnother(server, setup);
      await send(server, setup, setup.device, "water", {
        records: Array.from({ length: 5 }, () => ({ id: random(16), blob: sealedRecord(setup.account.keyId) })),
      });
      const query = `/v1/changes?app=water&since=0&known=0&epoch=${hex(setup.epoch)}&most=100`;
      const first = await signed(server, setup.serverId, other, "GET", query, { headers: between(at, ...anotherSend(6)) });
      assert.equal(first.answer, DONE);
      const r = first.reader;
      r.take(16);
      r.i64();
      const through = r.i64();
      r.u8();
      const numbers = [];
      for (let i = r.u32(); i > 0; i--) {
        r.take(16);
        numbers.push(r.i64());
        r.take(r.u32());
      }
      const rest = await fetchPage(server, setup, other, "water", { since: through, known: through });
      numbers.push(...rest.records.map((record) => record.number));
      assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6], `SQL before batch ${at}`);
    });
  }
});

test("a device removed between a call's read and its write: the guard stops the write, and the call ends 03", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    // devices/remove: 1 the server's row, 2 the target's state, 3 the write.
    const answer = await signed(server, setup.serverId, setup.device, "POST", "/v1/devices/remove", {
      body: other.id,
      headers: between(3, `UPDATE device SET state = 2 WHERE id = unhex('${hex(setup.device.id)}')`),
    });
    assert.deepEqual([...answer.bytes], [REMOVED]);
    const [target] = await server.sql("SELECT state FROM device WHERE id = unhex(?1)", hex(other.id));
    assert.equal(target.state, 1, "the other device was not removed");
    const [row] = await server.sql("SELECT revision FROM server");
    assert.equal(row.revision, 2, "the revision did not move");
  }));

test("a new epoch between a batch's read and its write: the guard stops the write, and the batch gets 0B", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const epoch = random(16);
    // Send: 1 the server's row, 2 told and the day's writes, 3 the write.
    const answer = await send(
      server,
      setup,
      setup.device,
      "water",
      { records: [{ id: random(16), blob: sealedRecord(setup.account.keyId) }] },
      between(3, `UPDATE server SET epoch = unhex('${hex(epoch)}')`),
    );
    assert.equal(answer.answer, OTHER_EPOCH);
    assert.deepEqual(answer.reader.take(16), epoch);
    assert.deepEqual(await server.sql("SELECT count(*) AS n FROM record"), [{ n: 0 }], "nothing was stored");
  }));

test("a join between a call's read and its write: the guard stops the write, and the call starts again", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const answer = await send(
      server,
      setup,
      setup.device,
      "water",
      { records: [{ id: random(16), blob: sealedRecord(setup.account.keyId) }] },
      between(3, "UPDATE server SET revision = revision + 1"),
    );
    assert.equal(answer.answer, DONE);
    assert.deepEqual(answer.results, [{ result: 0x00, number: 1 }], "stored once, at the second try");
  }));

test("a new epoch between a fetch's page and its write of Told: nothing is told, and the fetch gets 0B", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    await send(server, setup, setup.device, "water", {
      records: [{ id: random(16), blob: sealedRecord(setup.account.keyId) }],
    });
    const epoch = random(16);
    // Fetch: 1 the server's row, 2 the page, 3 the write of Told. Another
    // device makes a new epoch just before 3.
    const query = `/v1/changes?app=water&since=0&known=0&epoch=${hex(setup.epoch)}&most=100`;
    const answer = await signed(server, setup.serverId, other, "GET", query, {
      headers: between(3, `UPDATE server SET epoch = unhex('${hex(epoch)}')`, "DELETE FROM told"),
    });
    assert.equal(answer.answer, OTHER_EPOCH);
    assert.deepEqual(answer.reader.take(16), epoch);
    assert.deepEqual(
      await server.sql("SELECT count(*) AS n FROM told WHERE device = unhex(?1)", hex(other.id)),
      [{ n: 0 }],
      "the new epoch remembers nothing told from the old one",
    );
  }));
