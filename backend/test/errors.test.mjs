// What the server answers when D1 refuses, and when a guard finds that
// the state changed between a read and a write.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Miniflare } from "miniflare";
import {
  DONE,
  FULL,
  WRITES_USED,
  random,
  readHeads,
  sealedRecord,
  send,
  serverInUse,
  withServer,
} from "./harness.mjs";

// The texts of D1's own list of errors.
const DAILY_WRITES =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
const DAILY_READS =
  "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";
const DATABASE_FULL = "D1_ERROR: Exceeded maximum DB size.";

function failing(message, at) {
  return { "shk-test-d1-error": message, "shk-test-d1-error-at": String(at) };
}

const record = (setup) => ({ id: random(16), blob: sealedRecord(setup.account.keyId) });

test("when the day's row writes or reads are used, the answer is 07 02", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    // A batch makes three queries: the server's row, a read, then the writes.
    const writes = await send(server, setup, setup.device, "water", { records: [record(setup)] }, failing(DAILY_WRITES, 3));
    assert.deepEqual([...writes.bytes], [WRITES_USED, 0x02]);
    const reads = await readHeads(server, setup, setup.device, failing(DAILY_READS, 1));
    assert.deepEqual([...reads.bytes], [WRITES_USED, 0x02]);
  }));

test("when the database is full, the answer is 08", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const answer = await send(server, setup, setup.device, "water", { records: [record(setup)] }, failing(DATABASE_FULL, 3));
    assert.deepEqual([...answer.bytes], [FULL]);
  }));

test("any other fault is HTTP 500 with no body, which a device takes as not from the Worker", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const answer = await readHeads(server, setup, setup.device, failing("D1_ERROR: something else", 1));
    assert.equal(answer.status, 500);
    assert.equal(answer.bytes.length, 0);
  }));

test("a write whose guard did not hold starts again from its first read, at most three times", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const guard = "D1_ERROR: shk-guard: SQLITE_CONSTRAINT";
    const once = await send(server, setup, setup.device, "water", { records: [record(setup)] }, failing(guard, 3));
    assert.equal(once.answer, DONE);
    assert.deepEqual(once.results, [{ result: 0x00, number: 1 }], "stored once");
    const always = await send(
      server,
      setup,
      setup.device,
      "water",
      { cursor: 1, known: 1, records: [record(setup)] },
      failing(guard, "3,6,9"),
    );
    assert.equal(always.status, 500);
    const [row] = await server.sql("SELECT head FROM app");
    assert.equal(row.head, 1, "nothing was stored by the request that failed");
  }));

test("the Worker as it is deployed starts, and answers info", async () => {
  const bundle = readFileSync(new URL("../build/worker/index.js", import.meta.url), "utf8");
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: "shkriuss-sync",
          compatibilityDate: "2026-10-01",
          manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle } } },
          env: { DB: { type: "d1" }, FILES: { type: "r2" } },
        },
      },
    ],
  });
  try {
    const response = await mf.dispatchFetch("https://sync.example.workers.dev/v1/info", {
      headers: { "shk-test-now": "1" },
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.deepEqual([...bytes.subarray(0, 3)], [DONE, 1, 1]);
    assert.equal(bytes.length, 1 + 2 + 16 + 8 + 1 + 12);
    const clock = Number(new DataView(bytes.buffer).getBigInt64(19));
    assert.ok(Math.abs(clock - Date.now()) < 60_000, "its own clock, not the test's");
    assert.equal(response.headers.get("shk-test-row-writes"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    await mf.dispose();
  }
});
