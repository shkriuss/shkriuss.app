// The test vectors of crypto-design.md, "Sync keys": the account key, the
// device ID, a join statement and a signed request, with both
// signatures. They were computed with Python's cryptography package.
// Node computes them again here, and the Worker checks both signatures.
// Tests point 13 of "What the tests must cover".

import assert from "node:assert/strict";
import { createECDH, verify as nodeVerify, createPublicKey } from "node:crypto";
import { test } from "node:test";
import {
  DONE,
  SETUP,
  accountOfRecoveryKey,
  ascii,
  deviceFrom,
  enrolBody,
  hex,
  requestBytes,
  sealedName,
  sha256,
  signed,
  statementBytes,
  unhex,
  withServer,
} from "./harness.mjs";

const v = {
  recoveryKey: unhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"),
  keyId: unhex("b19d376f"),
  accountPublic: "59f0ee643d495c2d326a58558728cb7a28536daa950bc8be80cff2e3eef0d3b2",
  devicePrivate: "c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721",
  devicePublic:
    "0460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29f" +
    "b67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d44622" +
    "99",
  deviceId: "b18b86ce1389e46de87aa4a5131ce83c",
  serverId: unhex("0f0e0d0c0b0a09080706050403020100"),
  address: "https://sync.example.workers.dev",
  time: 1_767_225_600_000,
  statement:
    "53484b53594e4301010f0e0d0c0b0a09080706050403020100b19d376f000001" +
    "9b76daa8002068747470733a2f2f73796e632e6578616d706c652e776f726b65" +
    "72732e6465760460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce6" +
    "69622e60f29fb67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177" +
    "a3c294d4462299",
  statementSignature:
    "42f7cfec0f61f657951108eb309a24cd6b1f7af049cea9951dbfe232c7a0cf2d" +
    "5fd7f6fc42cc00eb6bced8a54c0d139a9b5121953259cf55574844ec076e5907",
  requestTime: 1_767_225_660_000,
  request:
    "53484b53594e4301100f0e0d0c0b0a09080706050403020100b18b86ce1389e4" +
    "6de87aa4a5131ce83c0000019b76db92600100092f76312f6865616473e3b0c4" +
    "4298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  requestSignature:
    "2d55454e770f3f27f5cb83e3869fcb76acb563a7f86e0dbcecf2cef843825bf9" +
    "b75946bff6aebbcb477595a46515b46e56580bf4b60b8ad9fdb5d31550b58f72",
};

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

/** The vector's device key, as a WebCrypto key that signs. */
async function vectorDevice() {
  const publicKey = unhex(v.devicePublic);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: b64url(unhex(v.devicePrivate)),
    x: b64url(publicKey.subarray(1, 33)),
    y: b64url(publicKey.subarray(33)),
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return deviceFrom(key, publicKey);
}

test("Node computes the same account key, device key, device ID and bytes", () => {
  const account = accountOfRecoveryKey(v.recoveryKey, v.keyId);
  assert.equal(hex(account.publicKey), v.accountPublic);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(unhex(v.devicePrivate));
  assert.equal(hex(ecdh.getPublicKey()), v.devicePublic);
  assert.equal(hex(sha256(unhex(v.devicePublic)).subarray(0, 16)), v.deviceId);
  const statement = statementBytes({
    type: 0x01,
    serverId: v.serverId,
    keyId: v.keyId,
    time: v.time,
    address: v.address,
    body: unhex(v.devicePublic),
  });
  assert.equal(hex(statement), v.statement);
  assert.equal(hex(account.sign(statement)), v.statementSignature, "Ed25519 signatures are deterministic");
  const request = requestBytes({
    serverId: v.serverId,
    deviceId: unhex(v.deviceId),
    time: v.requestTime,
    method: "GET",
    pathAndQuery: "/v1/heads",
    bodyHash: sha256(new Uint8Array(0)),
  });
  assert.equal(hex(request), v.request);
  const devicePublicKey = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: b64url(unhex(v.devicePublic).subarray(1, 33)), y: b64url(unhex(v.devicePublic).subarray(33)) },
    format: "jwk",
  });
  assert.ok(
    nodeVerify("sha256", request, { key: devicePublicKey, dsaEncoding: "ieee-p1363" }, unhex(v.requestSignature)),
    "the request signature checks in Node",
  );
});

test("the Worker checks the vector's request signature", () =>
  withServer(async (server) => {
    await server.info();
    await server.sql(
      "UPDATE server SET id = unhex(?1), state = 1, account_key = unhex(?2), key_id = unhex(?3)",
      hex(v.serverId),
      v.accountPublic,
      hex(v.keyId),
    );
    await server.sql(
      "INSERT INTO device (id, public_key, name, state, added, seen_day) VALUES (unhex(?1), unhex(?2), unhex(?3), 1, 0, 20454)",
      v.deviceId,
      v.devicePublic,
      hex(sealedName()),
    );
    const answer = await server.send("GET", "/v1/heads", {
      now: v.requestTime,
      headers: { "shk-device": v.deviceId, "shk-time": String(v.requestTime), "shk-signature": v.requestSignature },
    });
    assert.equal(answer.answer, DONE);
    const changed = await server.send("GET", "/v1/heads", {
      now: v.requestTime,
      headers: {
        "shk-device": v.deviceId,
        "shk-time": String(v.requestTime),
        "shk-signature": v.requestSignature.slice(0, -2) + "00",
      },
    });
    assert.equal(changed.answer, 0x04, "one changed byte does not check");
  }));

test("the Worker checks the vector's statement signature", () =>
  withServer(async (server) => {
    await server.info();
    await server.sql("UPDATE server SET id = unhex(?1)", hex(v.serverId));
    server.now = v.time;
    const device = await vectorDevice();
    const body = enrolBody({
      kind: 0x02,
      code: ascii(SETUP),
      statement: unhex(v.statement),
      signature: unhex(v.statementSignature),
      accountPublicKey: unhex(v.accountPublic),
    });
    const answer = await signed(server, v.serverId, device, "POST", "/v1/enrol", { body });
    assert.equal(answer.answer, DONE);
    assert.deepEqual(
      await server.sql("SELECT hex(account_key) AS key, hex(key_id) AS id FROM server"),
      [{ key: v.accountPublic.toUpperCase(), id: hex(v.keyId).toUpperCase() }],
    );
  }));
