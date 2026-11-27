// The checks of a signed request, and their order (sync-protocol.md,
// "Signed requests", point 2): the server is not closed, the device is
// one of its own and not removed, the time is within 5 minutes, then the
// signature. Tests point 2 of "What the tests must cover".

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOCK,
  CLOSED,
  DOES_NOT_CHECK,
  DONE,
  MINUTE,
  NOT_A_DEVICE,
  REMOVED,
  TOO_MUCH,
  hex,
  joinAnother,
  newDevice,
  random,
  readHeads,
  serverInUse,
  signed,
  withServer,
} from "./harness.mjs";

test("a request signed by a device that is in passes", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const heads = await readHeads(server, setup, setup.device);
    assert.equal(heads.answer, DONE);
  }));

test("a device the server does not know is 02", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const stranger = await newDevice();
    const answer = await signed(server, setup.serverId, stranger, "GET", "/v1/heads");
    assert.deepEqual([...answer.bytes], [NOT_A_DEVICE]);
  }));

test("a removed device is 03, before its clock and its signature are looked at", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    const removed = await signed(server, setup.serverId, setup.device, "POST", "/v1/devices/remove", {
      body: other.id,
    });
    assert.equal(removed.answer, DONE);
    const answer = await signed(server, setup.serverId, other, "GET", "/v1/heads", {
      time: server.now - 60 * MINUTE,
      signature: random(64),
    });
    assert.deepEqual([...answer.bytes], [REMOVED]);
  }));

test("a time more than 5 minutes off is 05 with the server's clock, before the signature", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    for (const offset of [5 * MINUTE + 1, -(5 * MINUTE + 1)]) {
      const answer = await signed(server, setup.serverId, setup.device, "GET", "/v1/heads", {
        time: server.now + offset,
        signature: random(64),
      });
      assert.equal(answer.answer, CLOCK);
      assert.equal(answer.reader.i64(), server.now);
    }
    for (const offset of [5 * MINUTE, -5 * MINUTE]) {
      const answer = await signed(server, setup.serverId, setup.device, "GET", "/v1/heads", {
        time: server.now + offset,
      });
      assert.equal(answer.answer, DONE, `${offset} is within 5 minutes`);
    }
  }));

test("a wrong signature is 04", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const cases = {
      "random bytes": { signature: random(64) },
      "another server": { serverId: random(16) },
      "another device ID": { signAsId: random(16) },
      "another path": { signedPathAndQuery: "/v1/devices" },
      "another time": { signedTime: server.now + 1 },
      "another method": { signedMethod: "POST" },
    };
    for (const [name, change] of Object.entries(cases)) {
      const answer = await signed(server, change.serverId ?? setup.serverId, setup.device, "GET", "/v1/heads", change);
      assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK], name);
    }
    const otherBody = await signed(server, setup.serverId, setup.device, "POST", "/v1/devices/name", {
      body: new Uint8Array(70),
      signedPart: new Uint8Array(71),
    });
    assert.deepEqual([...otherBody.bytes], [DOES_NOT_CHECK], "another body");
  }));

test("a signature by another device's key is 04", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const other = await joinAnother(server, setup);
    const answer = await signed(server, setup.serverId, other, "GET", "/v1/heads", {
      deviceHeader: hex(setup.device.id),
      signAsId: setup.device.id,
    });
    assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK]);
  }));

test("headers that are missing or not of their layout are 04", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const id = hex(setup.device.id);
    const good = { "shk-device": id, "shk-time": String(server.now), "shk-signature": hex(random(64)) };
    const bad = [
      { ...good, "shk-device": undefined },
      { ...good, "shk-device": id.toUpperCase() },
      { ...good, "shk-device": id.slice(2) },
      { ...good, "shk-time": "12x" },
      { ...good, "shk-time": "" },
      { ...good, "shk-signature": hex(random(63)) },
    ];
    for (const headers of bad) {
      const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined));
      const answer = await server.send("GET", "/v1/heads", { headers: clean });
      assert.deepEqual([...answer.bytes], [DOES_NOT_CHECK], JSON.stringify(headers));
    }
  }));

test("a query that a call does not take is 04", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const withQuery = await signed(server, setup.serverId, setup.device, "GET", "/v1/heads?x=1");
    assert.deepEqual([...withQuery.bytes], [DOES_NOT_CHECK]);
  }));

test("a body longer than a call allows is 0C, after the checks of the device and the clock", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const long = new Uint8Array(1_100_001);
    const answer = await signed(server, setup.serverId, setup.device, "POST", "/v1/changes?app=water", {
      body: long,
    });
    assert.deepEqual([...answer.bytes], [TOO_MUCH]);
    const stranger = await newDevice();
    const strangers = await signed(server, setup.serverId, stranger, "POST", "/v1/changes?app=water", {
      body: long,
    });
    assert.deepEqual([...strangers.bytes], [NOT_A_DEVICE]);
  }));

test("a closed server is 06 to every request but info, without checking who asks", () =>
  withServer(async (server) => {
    const setup = await serverInUse(server);
    const closed = await signed(server, setup.serverId, setup.device, "POST", "/v1/account/delete", {
      body: setup.serverId,
    });
    assert.equal(closed.answer, DONE);
    const stranger = await newDevice();
    for (const [method, path] of [
      ["GET", "/v1/heads"],
      ["POST", "/v1/enrol"],
      ["GET", "/v1/nothing"],
    ]) {
      assert.deepEqual([...(await server.send(method, path)).bytes], [CLOSED], path);
      const answer = await signed(server, setup.serverId, stranger, method, path);
      assert.deepEqual([...answer.bytes], [CLOSED], path);
    }
    const info = await server.info();
    assert.equal(info.state, 0x02);
  }));
