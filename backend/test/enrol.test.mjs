// Joining: `enrol` and `enrol-code` (sync-protocol.md, "Joining").
// Tests points 8 and 9 of "What the tests must cover": the codes, and the
// order of the checks of `enrol`, with nothing stored before the check of
// the code.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOCK,
  DOES_NOT_CHECK,
  DONE,
  MINUTE,
  OTHER_ACCOUNT,
  REMOVED,
  SETUP,
  WRONG_CODE,
  ascii,
  enrolBody,
  hex,
  join,
  joinAnother,
  newAccount,
  newDevice,
  random,
  readDevices,
  readHeads,
  serverInUse,
  signed,
  statementBytes,
  withServer,
} from "./harness.mjs";

async function deviceCode(server, setup) {
  const answer = await signed(server, setup.serverId, setup.device, "POST", "/v1/enrol-code");
  assert.equal(answer.answer, DONE);
  return { code: answer.reader.take(8), ends: answer.reader.i64() };
}

test("the first device joins an empty server with the setup code", () =>
  withServer(async (server) => {
    const { id } = await server.info();
    const account = newAccount();
    const device = await newDevice();
    const answer = await join(server, id, account, device);
    assert.equal(answer.answer, DONE);
    const epoch = answer.reader.take(16);
    assert.equal(answer.reader.remaining, 0);
    assert.equal(answer.rowWrites, 3, "the device, the server's row and the used setup code");
    assert.equal((await server.info()).state, 0x01, "in use");
    const setup = { serverId: id, account, device, epoch };
    const heads = await readHeads(server, setup, device);
    assert.deepEqual(heads.epoch, epoch);
    assert.deepEqual(heads.keyId, account.keyId);
    assert.equal(heads.revision, 1);
    const { list } = await readDevices(server, setup, device);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].id, device.id);
    assert.deepEqual(list[0].publicKey, device.publicKey);
    assert.equal(list[0].state, 0x01);
    assert.equal(list[0].added, server.now);
  }));

test("an empty server takes only a setup code, and only the right one", () =>
  withServer(async (server) => {
    const { id } = await server.info();
    const account = newAccount();
    const device = await newDevice();
    const asDeviceCode = await join(server, id, account, device, { kind: 0x01, code: ascii("ABCDEFGH") });
    assert.deepEqual([...asDeviceCode.bytes], [WRONG_CODE]);
    const wrong = await join(server, id, account, device, { code: ascii("ABCDEFGHJKLMNPQRSTUVWXYZ22") });
    assert.deepEqual([...wrong.bytes], [WRONG_CODE]);
    assert.equal(wrong.rowWrites, 0, "nothing is stored before the check of the code");
    assert.equal((await server.info()).state, 0x00);
  }));

test("without a SETUP_CODE no setup code is right", () =>
  withServer(
    async (server) => {
      const { id } = await server.info();
      const answer = await join(server, id, newAccount(), await newDevice(), { code: ascii(SETUP) });
      assert.deepEqual([...answer.bytes], [WRONG_CODE]);
    },
    { setupCode: null },
  ));

test("the saved setup code may have spaces around it", () =>
  withServer(
    async (server) => {
      const { id } = await server.info();
      const answer = await join(server, id, newAccount(), await newDevice());
      assert.equal(answer.answer, DONE);
    },
    { setupCode: ` ${SETUP}\n` },
  ));

test("a used setup code is never taken again", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const second = await newDevice();
    const answer = await join(server, setup.serverId, setup.account, second);
    assert.deepEqual([...answer.bytes], [WRONG_CODE]);
    assert.equal(answer.rowWrites, 0);
  }));

test("a device code adds one device, once", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const { code, ends } = await deviceCode(server, setup);
    assert.match(Buffer.from(code).toString("ascii"), /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(ends, server.now + 10 * MINUTE);
    const second = await newDevice();
    const answer = await join(server, setup.serverId, setup.account, second, { kind: 0x01, code });
    assert.equal(answer.answer, DONE);
    assert.deepEqual(answer.reader.take(16), setup.epoch);
    assert.equal(answer.rowWrites, 3, "the device, the server's row and the used device code");
    const third = await newDevice();
    const again = await join(server, setup.serverId, setup.account, third, { kind: 0x01, code });
    assert.deepEqual([...again.bytes], [WRONG_CODE]);
  }));

test("a device code lasts 10 minutes", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const { code } = await deviceCode(server, setup);
    server.now += 10 * MINUTE + 1;
    const late = await join(server, setup.serverId, setup.account, await newDevice(), { kind: 0x01, code });
    assert.deepEqual([...late.bytes], [WRONG_CODE]);
    assert.equal(late.rowWrites, 0, "a code that ended costs nothing");
    server.now -= 1;
    const inTime = await join(server, setup.serverId, setup.account, await newDevice(), { kind: 0x01, code });
    assert.equal(inTime.answer, DONE);
  }));

test("a device code is void after 5 wrong tries, and each wrong try costs one", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const { code } = await deviceCode(server, setup);
    const wrong = ascii("22222222");
    for (let i = 0; i < 4; i++) {
      const answer = await join(server, setup.serverId, setup.account, await newDevice(), { kind: 0x01, code: wrong });
      assert.deepEqual([...answer.bytes], [WRONG_CODE]);
      assert.equal(answer.rowWrites, 1, "the try is counted, and nothing else is stored");
    }
    const fourWrong = await join(server, setup.serverId, setup.account, await newDevice(), { kind: 0x01, code });
    assert.equal(fourWrong.answer, DONE, "four wrong tries leave the code good");

    const next = await deviceCode(server, setup);
    for (let i = 0; i < 5; i++) {
      await join(server, setup.serverId, setup.account, await newDevice(), { kind: 0x01, code: wrong });
    }
    const afterFive = await join(server, setup.serverId, setup.account, await newDevice(), {
      kind: 0x01,
      code: next.code,
    });
    assert.deepEqual([...afterFive.bytes], [WRONG_CODE]);
  }));

test("a new device code voids the one before", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const first = await deviceCode(server, setup);
    const second = await deviceCode(server, setup);
    const old = await join(server, setup.serverId, setup.account, await newDevice(), { kind: 0x01, code: first.code });
    assert.deepEqual([...old.bytes], [WRONG_CODE]);
    const fresh = await join(server, setup.serverId, setup.account, await newDevice(), {
      kind: 0x01,
      code: second.code,
    });
    assert.equal(fresh.answer, DONE);
  }));

test("a device that is in already gets 00 again, whatever its code, and nothing changes", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const answer = await join(server, setup.serverId, setup.account, setup.device, {
      kind: 0x01,
      code: ascii("22222222"),
    });
    assert.equal(answer.answer, DONE);
    assert.deepEqual(answer.reader.take(16), setup.epoch);
    assert.equal(answer.rowWrites, 0);
  }));

test("a removed device cannot join again, even with a good code", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    await signed(server, setup.serverId, setup.device, "POST", "/v1/devices/remove", { body: other.id });
    const { code } = await deviceCode(server, setup);
    const answer = await join(server, setup.serverId, setup.account, other, { kind: 0x01, code });
    assert.deepEqual([...answer.bytes], [REMOVED]);
    assert.equal(answer.rowWrites, 0);
  }));

test("the statement must be a join statement for this server, its address, and of the last 10 minutes", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const { code } = await deviceCode(server, setup);
    const cases = {
      "another server ID": { statementServerId: random(16) },
      "another address": { address: "https://other.example.workers.dev" },
      "an address in upper case": { address: "https://SYNC.example.workers.dev" },
      "older than 10 minutes": { statementTime: server.now - 10 * MINUTE - 1 },
      "from the future": { statementTime: server.now + 6 * MINUTE },
      "a wrong signature": { statementSignature: random(64) },
    };
    for (const [name, options] of Object.entries(cases)) {
      const answer = await join(server, setup.serverId, setup.account, await newDevice(), {
        kind: 0x01,
        code,
        ...options,
      });
      assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK], name);
      assert.equal(answer.rowWrites, 0, name);
    }
    const inTime = await join(server, setup.serverId, setup.account, await newDevice(), {
      kind: 0x01,
      code,
      statementTime: server.now - 10 * MINUTE,
    });
    assert.equal(inTime.answer, DONE, "a statement of exactly 10 minutes ago is good");
  }));

test("a new account key statement does not join", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const { code } = await deviceCode(server, setup);
    const device = await newDevice();
    const other = newAccount();
    const statement = statementBytes({
      type: 0x02,
      serverId: setup.serverId,
      keyId: setup.account.keyId,
      time: server.now,
      body: new Uint8Array([...other.publicKey, ...other.keyId]),
    });
    const body = enrolBody({
      kind: 0x01,
      code,
      statement,
      signature: setup.account.sign(statement),
      accountPublicKey: setup.account.publicKey,
    });
    const answer = await signed(server, setup.serverId, device, "POST", "/v1/enrol", { body });
    assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK]);
  }));

test("a statement of another recovery key is 0A with the current key ID", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const { code } = await deviceCode(server, setup);
    const answer = await join(server, setup.serverId, newAccount(), await newDevice(), { kind: 0x01, code });
    assert.equal(answer.answer, OTHER_ACCOUNT);
    assert.deepEqual(answer.reader.take(4), setup.account.keyId);
    assert.equal(answer.rowWrites, 0);
  }));

test("a statement signed by another key under the current key ID does not check", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const { code } = await deviceCode(server, setup);
    const impostor = { ...newAccount(), keyId: setup.account.keyId };
    const answer = await join(server, setup.serverId, impostor, await newDevice(), { kind: 0x01, code });
    assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK]);
  }));

test("the request must be signed by the key the statement holds", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const { code } = await deviceCode(server, setup);
    const device = await newDevice();
    const other = await newDevice();
    const header = await join(server, setup.serverId, setup.account, device, {
      kind: 0x01,
      code,
      deviceHeader: hex(other.id),
      signAsId: other.id,
    });
    assert.deepEqual([...header.bytes], [DOES_NOT_CHECK], "the headers name another device");
    const signature = await join(server, setup.serverId, setup.account, device, {
      kind: 0x01,
      code,
      signature: random(64),
    });
    assert.deepEqual([...signature.bytes], [DOES_NOT_CHECK], "a wrong request signature");
  }));

test("the request's time is checked before anything else of enrol", () =>
  withServer(async (server) => {
    const { id } = await server.info();
    const answer = await join(server, id, newAccount(), await newDevice(), {
      time: server.now - 6 * MINUTE,
      statementSignature: random(64),
    });
    assert.equal(answer.answer, CLOCK);
  }));

test("the setup code alone decides who claims an empty server", () =>
  withServer(async (server) => {
    const { id } = await server.info();
    const stranger = newAccount();
    const first = await join(server, id, stranger, await newDevice());
    assert.equal(first.answer, DONE);
    const user = newAccount();
    const answer = await join(server, id, user, await newDevice());
    assert.equal(answer.answer, OTHER_ACCOUNT, "the user's own join names the stranger's recovery key");
    assert.deepEqual(answer.reader.take(4), stranger.keyId);
  }));

test("enrol bodies that are cut, too long or of a wrong layout do not check", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const device = await newDevice();
    const statement = statementBytes({
      type: 0x01,
      serverId: setup.serverId,
      keyId: setup.account.keyId,
      time: server.now,
      body: device.publicKey,
    });
    const good = enrolBody({
      kind: 0x01,
      code: ascii("ABCDEFGH"),
      statement,
      signature: setup.account.sign(statement),
      accountPublicKey: setup.account.publicKey,
    });
    const bodies = {
      cut: good.subarray(0, good.length - 1),
      "too long": new Uint8Array([...good, 0]),
      "another kind of code": new Uint8Array([0x03, ...good.subarray(1)]),
      "a name too short": enrolBody({
        kind: 0x01,
        code: ascii("ABCDEFGH"),
        statement,
        signature: setup.account.sign(statement),
        accountPublicKey: setup.account.publicKey,
        name: new Uint8Array(51),
      }),
      empty: new Uint8Array(0),
    };
    for (const [name, body] of Object.entries(bodies)) {
      const answer = await signed(server, setup.serverId, device, "POST", "/v1/enrol", { body });
      assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK], name);
    }
  }));

test("a user with no device left joins again with a new setup code", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    await signed(server, setup.serverId, setup.device, "POST", "/v1/devices/remove", { body: setup.device.id });
    const fresh = "ZZZZZZZZZZZZZZZZZZZZZZZZZ2";
    await server.saveSetupCode(fresh);
    const old = await join(server, setup.serverId, setup.account, await newDevice());
    assert.deepEqual([...old.bytes], [WRONG_CODE], "the first setup code was used");
    const device = await newDevice();
    const answer = await join(server, setup.serverId, setup.account, device, { code: ascii(fresh) });
    assert.equal(answer.answer, DONE);
    assert.deepEqual(answer.reader.take(16), setup.epoch);
    const heads = await readHeads(server, { ...setup, device }, device);
    assert.equal(heads.revision, 3, "a join, a removal and a join");
    const stranger = await join(server, setup.serverId, newAccount(), await newDevice(), { code: ascii(fresh) });
    assert.equal(stranger.answer, OTHER_ACCOUNT, "a server with an account checks the statement before the code");
  }));
