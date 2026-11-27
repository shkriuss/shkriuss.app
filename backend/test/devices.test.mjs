// The list of devices, removing and renaming, the account revision, a new
// account key and closing the server. Tests points 7 and 12 of "What the
// tests must cover".

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAY,
  DOES_NOT_CHECK,
  DONE,
  NOW,
  OTHER_ACCOUNT,
  REMOVED,
  Writer,
  hex,
  join,
  joinAnother,
  newAccount,
  newDevice,
  random,
  readDevices,
  readHeads,
  sealedName,
  serverInUse,
  signed,
  statementBytes,
  withServer,
} from "./harness.mjs";

async function remove(server, setup, by, target) {
  return signed(server, setup.serverId, by, "POST", "/v1/devices/remove", { body: target.id ?? target });
}

async function rename(server, setup, device, name) {
  const body = new Writer().u16(name.length).bytes(name).finish();
  return signed(server, setup.serverId, device, "POST", "/v1/devices/name", { body });
}

test("the list holds every device with its key, state, times and sealed name", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    server.now += DAY;
    const other = await joinAnother(server, setup);
    const { list, reader } = await readDevices(server, setup, other);
    assert.equal(reader.remaining, 0);
    assert.deepEqual(
      list.map((d) => [hex(d.id), hex(d.publicKey), d.state]),
      [
        [hex(setup.device.id), hex(setup.device.publicKey), 0x01],
        [hex(other.id), hex(other.publicKey), 0x01],
      ],
    );
    assert.equal(list[0].added, NOW);
    assert.equal(list[1].added, NOW + DAY);
    assert.equal(list[0].seenDay, Math.floor((NOW + DAY) / DAY) * DAY, "the day it was last seen, from its first ms");
  }));

test("the day a device was last seen is written once on each day it calls", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const sameDay = await readHeads(server, setup, setup.device);
    assert.equal(sameDay.rowWrites, 0);
    server.now += DAY;
    const nextDay = await readHeads(server, setup, setup.device);
    assert.equal(nextDay.rowWrites, 1);
    const again = await readHeads(server, setup, setup.device);
    assert.equal(again.rowWrites, 0);
  }));

test("removing a device moves the revision and answers it; the removed device is 03", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    const before = await readHeads(server, setup, setup.device);
    assert.equal(before.revision, 2, "two joins");
    const answer = await remove(server, setup, setup.device, other);
    assert.equal(answer.answer, DONE);
    assert.equal(answer.reader.i64(), 3);
    assert.equal(answer.rowWrites, 2, "the device and the server's row");
    assert.equal((await readHeads(server, setup, setup.device)).revision, 3);
    const removed = await readHeads(server, setup, other);
    assert.deepEqual([...removed.bytes], [REMOVED]);
    const { list } = await readDevices(server, setup, setup.device);
    assert.equal(list.find((d) => hex(d.id) === hex(other.id)).state, 0x02);
  }));

test("removing a device that is removed already, or unknown, changes nothing", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    await remove(server, setup, setup.device, other);
    const again = await remove(server, setup, setup.device, other);
    assert.equal(again.answer, DONE);
    assert.equal(again.reader.i64(), 3);
    assert.equal(again.rowWrites, 0);
    const unknown = await remove(server, setup, setup.device, random(16));
    assert.equal(unknown.reader.i64(), 3);
    assert.equal(unknown.rowWrites, 0);
  }));

test("a device can remove itself", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const answer = await remove(server, setup, setup.device, setup.device);
    assert.equal(answer.answer, DONE);
    assert.deepEqual([...(await readHeads(server, setup, setup.device)).bytes], [REMOVED]);
  }));

test("renaming a device stores its new sealed name and moves the revision", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const name = sealedName(211);
    const answer = await rename(server, setup, setup.device, name);
    assert.equal(answer.answer, DONE);
    assert.equal(answer.reader.i64(), 2);
    const same = await rename(server, setup, setup.device, name);
    assert.equal(same.reader.i64(), 2, "the same name again changes nothing");
    assert.equal(same.rowWrites, 0);
    const { list } = await readDevices(server, setup, setup.device);
    assert.deepEqual(hex(list[0].name), hex(name));
    for (const length of [51, 212]) {
      const bad = await rename(server, setup, setup.device, sealedName(length));
      assert.deepEqual([...bad.bytes], [DOES_NOT_CHECK], `${length} bytes`);
    }
  }));

function newKeyStatement(setup, next, signer = setup.account) {
  const statement = statementBytes({
    type: 0x02,
    serverId: setup.serverId,
    keyId: signer.keyId,
    time: 1,
    body: new Uint8Array([...next.publicKey, ...next.keyId]),
  });
  return new Writer().u16(statement.length).bytes(statement).bytes(signer.sign(statement)).finish();
}

test("a new account key, signed by the current one, replaces it; the devices stay", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const next = newAccount();
    const body = newKeyStatement(setup, next);
    const answer = await signed(server, setup.serverId, setup.device, "POST", "/v1/account-key", { body });
    assert.equal(answer.answer, DONE);
    const heads = await readHeads(server, setup, setup.device);
    assert.deepEqual(heads.keyId, next.keyId);
    assert.equal(heads.revision, 2);
    const again = await signed(server, setup.serverId, setup.device, "POST", "/v1/account-key", { body });
    assert.equal(again.answer, DONE, "the same statement again is 00");
    assert.equal(again.rowWrites, 0);
    assert.equal((await readHeads(server, setup, setup.device)).revision, 2);
    // A device now joins only with a statement of the new key.
    const code = await signed(server, setup.serverId, setup.device, "POST", "/v1/enrol-code");
    const old = await join(server, setup.serverId, setup.account, await newDevice(), {
      kind: 0x01,
      code: code.reader.take(8),
    });
    assert.equal(old.answer, OTHER_ACCOUNT);
    assert.deepEqual(old.reader.take(4), next.keyId);
  }));

test("a new account key statement signed by a key that is not the current one is 0A", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const next = newAccount();
    const first = await signed(server, setup.serverId, setup.device, "POST", "/v1/account-key", {
      body: newKeyStatement(setup, next),
    });
    assert.equal(first.answer, DONE);
    // An old statement, sent again, signed by the old key.
    const replay = await signed(server, setup.serverId, setup.device, "POST", "/v1/account-key", {
      body: newKeyStatement(setup, newAccount()),
    });
    assert.equal(replay.answer, OTHER_ACCOUNT);
    assert.deepEqual(replay.reader.take(4), next.keyId);
  }));

test("a new account key statement that does not check is 04", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const impostor = { ...newAccount(), keyId: setup.account.keyId };
    const forged = await signed(server, setup.serverId, setup.device, "POST", "/v1/account-key", {
      body: newKeyStatement(setup, newAccount(), impostor),
    });
    assert.deepEqual([...forged.bytes], [DOES_NOT_CHECK]);
    const otherServer = statementBytes({
      type: 0x02,
      serverId: random(16),
      keyId: setup.account.keyId,
      time: 1,
      body: random(36),
    });
    const body = new Writer().u16(otherServer.length).bytes(otherServer).bytes(setup.account.sign(otherServer)).finish();
    const wrongServer = await signed(server, setup.serverId, setup.device, "POST", "/v1/account-key", { body });
    assert.deepEqual([...wrongServer.bytes], [DOES_NOT_CHECK]);
    assert.equal((await readHeads(server, setup, setup.device)).revision, 1);
  }));

test("closing the server deletes its devices, codes and account key, and it stays closed", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    await joinAnother(server, setup);
    const wrongId = await signed(server, setup.serverId, setup.device, "POST", "/v1/account/delete", {
      body: random(16),
    });
    assert.deepEqual([...wrongId.bytes], [DOES_NOT_CHECK]);
    await signed(server, setup.serverId, setup.device, "POST", "/v1/enrol-code");
    const [{ rows }] = await server.sql(
      `SELECT (SELECT count(*) FROM device) + (SELECT count(*) FROM told) + (SELECT count(*) FROM device_code)
         + (SELECT count(*) FROM used_setup_code) + 1 AS rows`,
    );
    const closed = await signed(server, setup.serverId, setup.device, "POST", "/v1/account/delete", {
      body: setup.serverId,
    });
    assert.equal(closed.answer, DONE);
    assert.equal(closed.rowWrites, rows, "one for each row deleted, and the server's row");
    assert.deepEqual(await server.sql("SELECT count(*) AS n FROM device"), [{ n: 0 }]);
    assert.deepEqual(await server.sql("SELECT count(*) AS n FROM device_code"), [{ n: 0 }]);
    assert.deepEqual(await server.sql("SELECT account_key, key_id FROM server"), [{ account_key: null, key_id: null }]);
    assert.equal((await server.info()).state, 0x02);
    const again = await join(server, setup.serverId, newAccount(), await newDevice());
    assert.deepEqual([...again.bytes], [0x06], "a closed server never takes a device again");
  }));

test("bodies of the device and account calls that are cut, too long or of a wrong layout do not check", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const cases = [
      ["POST", "/v1/devices/remove", random(15)],
      ["POST", "/v1/devices/remove", random(17)],
      ["POST", "/v1/devices/name", new Writer().u16(60).bytes(random(59)).finish()],
      ["POST", "/v1/devices/name", new Writer().u16(60).bytes(random(61)).finish()],
      ["POST", "/v1/enrol-code", random(1)],
      ["POST", "/v1/account-key", new Writer().u16(10).bytes(random(10)).finish()],
      ["POST", "/v1/account-key", random(1)],
      ["POST", "/v1/account/delete", setup.serverId.subarray(0, 15)],
      ["GET", "/v1/devices?x=1", undefined],
    ];
    for (const [method, path, body] of cases) {
      const answer = await signed(server, setup.serverId, setup.device, method, path, { body });
      assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK], `${path} with ${body?.length} bytes`);
      assert.equal(answer.rowWrites, 0);
    }
    assert.equal((await server.info()).state, 0x01);
  }));
