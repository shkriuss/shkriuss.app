// Every call can be sent twice without harm: the second time leaves the
// server as the first did, though the answer can differ. The one
// exception is a new device code (sync-protocol.md, Rules, point 7).
// Each request here is sent twice byte for byte, with the same signature,
// as a request caught on the network and sent again within 5 minutes.
// Tests points 10 and 11 of "What the tests must cover".

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DONE,
  SETUP,
  Writer,
  ascii,
  batchBody,
  enrolBody,
  hex,
  joinAnother,
  newAccount,
  newDevice,
  random,
  requestBytes,
  sealedName,
  sealedRecord,
  serverInUse,
  sha256,
  statementBytes,
  withServer,
} from "./harness.mjs";

/** Signs a request once, and gives a function that sends exactly that request. */
async function replayable(server, serverId, device, method, pathAndQuery, body = new Uint8Array(0), signedPart = body) {
  const time = server.now;
  const bytes = requestBytes({ serverId, deviceId: device.id, time, method, pathAndQuery, bodyHash: sha256(signedPart) });
  const signature = await device.sign(bytes);
  return () =>
    server.send(method, pathAndQuery, {
      body: method === "GET" ? undefined : body,
      headers: { "shk-device": hex(device.id), "shk-time": String(time), "shk-signature": hex(signature) },
    });
}

/** Everything the server stores, so that two states can be compared. */
async function state(server) {
  const tables = ["server", "device", "app", "told", "record", "device_code", "used_setup_code", "day_writes"];
  const out = {};
  for (const table of tables) {
    out[table] = (await server.sql(`SELECT * FROM ${table}`)).map((row) => JSON.stringify(row)).sort();
  }
  const listing = await (await server.files()).list();
  out.chunks = listing.objects.map((o) => o.key).sort();
  return JSON.stringify(out);
}

async function twice(server, request, { firstWrites, secondAnswer } = {}) {
  const first = await request();
  assert.equal(first.answer, DONE, "the first time");
  if (firstWrites !== undefined) assert.equal(first.rowWrites, firstWrites, "the first time's row writes");
  const after = await state(server);
  const second = await request();
  if (secondAnswer !== undefined) assert.equal(second.answer, secondAnswer, "the second time");
  assert.equal(await state(server), after, "the second time leaves the server as the first did");
  return { first, second };
}

test("enrol twice", () =>
  withServer(async (server) => {
    const { id } = await server.info();
    const account = newAccount();
    const device = await newDevice();
    const statement = statementBytes({ type: 0x01, serverId: id, keyId: account.keyId, time: server.now, body: device.publicKey });
    const body = enrolBody({
      kind: 0x02,
      code: ascii(SETUP),
      statement,
      signature: account.sign(statement),
      accountPublicKey: account.publicKey,
    });
    const request = await replayable(server, id, device, "POST", "/v1/enrol", body);
    const { second } = await twice(server, request, { firstWrites: 3, secondAnswer: DONE });
    assert.equal(second.rowWrites, 0);
  }));

test("devices, heads and a page twice", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    await twice(server, await replayable(server, setup.serverId, setup.device, "GET", "/v1/devices"), {
      firstWrites: 0,
      secondAnswer: DONE,
    });
    await twice(server, await replayable(server, setup.serverId, setup.device, "GET", "/v1/heads"), {
      firstWrites: 0,
      secondAnswer: DONE,
    });
    const query = `/v1/changes?app=water&since=0&known=0&epoch=${hex(setup.epoch)}&most=10`;
    await twice(server, await replayable(server, setup.serverId, setup.device, "GET", query), {
      firstWrites: 0,
      secondAnswer: DONE,
    });
  }));

test("a batch twice: the second is refused with 01, and the server stays as it was", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const records = [{ id: random(16), blob: sealedRecord(setup.account.keyId) }];
    const body = batchBody({ epoch: setup.epoch, records });
    const request = await replayable(server, setup.serverId, setup.device, "POST", "/v1/changes?app=water", body);
    const { second } = await twice(server, request, { firstWrites: 5, secondAnswer: DONE });
    assert.equal(second.rowWrites, 0);
    assert.equal(second.bytes[1 + 16 + 16 + 4], 0x01);
  }));

test("removing and renaming a device twice", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    const remove = await replayable(server, setup.serverId, setup.device, "POST", "/v1/devices/remove", other.id);
    const removed = await twice(server, remove, { firstWrites: 2, secondAnswer: DONE });
    assert.deepEqual(removed.second.bytes, removed.first.bytes, "the same revision");
    const name = sealedName();
    const body = new Writer().u16(name.length).bytes(name).finish();
    const rename = await replayable(server, setup.serverId, setup.device, "POST", "/v1/devices/name", body);
    await twice(server, rename, { firstWrites: 2, secondAnswer: DONE });
  }));

test("a new account key twice", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const next = newAccount();
    const statement = statementBytes({
      type: 0x02,
      serverId: setup.serverId,
      keyId: setup.account.keyId,
      time: 1,
      body: new Uint8Array([...next.publicKey, ...next.keyId]),
    });
    const body = new Writer().u16(statement.length).bytes(statement).bytes(setup.account.sign(statement)).finish();
    const request = await replayable(server, setup.serverId, setup.device, "POST", "/v1/account-key", body);
    await twice(server, request, { firstWrites: 1, secondAnswer: DONE });
  }));

test("files twice: send, have, fetch and delete", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const fileId = random(16);
    const chunk = random(1000);
    const hash = sha256(chunk);
    const head = new Writer().u16(1).bytes(fileId).bytes(hash).u32(0).u32(chunk.length).bytes(sha256(chunk)).finish();
    const sendRequest = await replayable(
      server,
      setup.serverId,
      setup.device,
      "POST",
      "/v1/files/send?app=notes",
      new Uint8Array([...head, ...chunk]),
      head,
    );
    await twice(server, sendRequest, { firstWrites: 0, secondAnswer: DONE });
    const ask = new Writer().u16(1).bytes(fileId).bytes(hash).finish();
    await twice(server, await replayable(server, setup.serverId, setup.device, "POST", "/v1/files/have?app=notes", ask), {
      secondAnswer: DONE,
    });
    const fetch = new Writer().u16(1).bytes(fileId).bytes(hash).u32(0).finish();
    await twice(server, await replayable(server, setup.serverId, setup.device, "POST", "/v1/files/fetch?app=notes", fetch), {
      secondAnswer: DONE,
    });
    const batch = batchBody({ epoch: setup.epoch, records: [{ id: fileId, blob: sealedRecord(setup.account.keyId) }] });
    await (await replayable(server, setup.serverId, setup.device, "POST", "/v1/changes?app=notes", batch))();
    const deletion = new Writer().u16(1).bytes(fileId).i64(1).finish();
    const deleteRequest = await replayable(server, setup.serverId, setup.device, "POST", "/v1/files/delete?app=notes", deletion);
    const { second } = await twice(server, deleteRequest, { firstWrites: 2, secondAnswer: DONE });
    assert.deepEqual([...second.bytes], [DONE, 0x00]);
  }));

test("closing the server twice: the second is 06, and nothing changes", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const request = await replayable(server, setup.serverId, setup.device, "POST", "/v1/account/delete", setup.serverId);
    await twice(server, request, { secondAnswer: 0x06 });
  }));

test("a new device code is the one exception: each one replaces the one before", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const request = await replayable(server, setup.serverId, setup.device, "POST", "/v1/enrol-code");
    const first = await request();
    assert.equal(first.rowWrites, 1);
    const second = await request();
    assert.equal(second.answer, DONE);
    assert.notDeepEqual(second.bytes.subarray(1, 9), first.bytes.subarray(1, 9));
    const rows = await server.sql("SELECT count(*) AS n FROM device_code");
    assert.deepEqual(rows, [{ n: 1 }]);
  }));
