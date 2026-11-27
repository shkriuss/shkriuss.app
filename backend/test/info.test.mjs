// `info`, the version in the path, and calls that do not exist.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DOES_NOT_CHECK, NOT_THIS_VERSION, NOW, withServer } from "./harness.mjs";

test("info names the versions, the server ID, the clock, the state and the limits", () =>
  withServer(async (server) => {
    const info = await server.info();
    assert.equal(info.status, 200);
    assert.equal(info.answer, 0x00);
    assert.equal(info.lowest, 1);
    assert.equal(info.highest, 1);
    assert.equal(info.id.length, 16);
    assert.equal(info.clock, NOW);
    assert.equal(info.state, 0x00, "no account yet");
    assert.equal(info.mostRecords, 100);
    assert.equal(info.mostBytes, 524288);
    assert.equal(info.mostFileItems, 128, "the owner's choice: 128 Notes files of 25 MB fit the R2 calls of one request");
    assert.equal(info.reader.remaining, 0);
  }));

test("the server makes its ID once, on the first use of its database", () =>
  withServer(async (server) => {
    const first = await server.info();
    const second = await server.info();
    assert.deepEqual(second.id, first.id);
    assert.equal(second.rowWrites, 0, "a second info writes nothing");
  }));

test("a path outside /v1/ is another version of the interface", () =>
  withServer(async (server) => {
    for (const path of ["/v2/info", "/", "/info", "/v1"]) {
      const answer = await server.send("GET", path);
      assert.equal(answer.status, 200);
      assert.deepEqual([...answer.bytes], [NOT_THIS_VERSION, 1, 1], path);
    }
  }));

test("info by POST, and a call that does not exist, do not check", () =>
  withServer(async (server) => {
    assert.deepEqual([...(await server.send("POST", "/v1/info")).bytes], [DOES_NOT_CHECK]);
    assert.deepEqual([...(await server.send("GET", "/v1/nothing")).bytes], [DOES_NOT_CHECK]);
    assert.deepEqual([...(await server.send("PUT", "/v1/changes")).bytes], [DOES_NOT_CHECK]);
  }));
