// Starts the test Worker (test/entry.ts, built into build/test/) in
// Miniflare, with its own D1 database and R2 bucket, and plays devices
// with real keys: a P-256 device key and an Ed25519 account key, signed
// as sync-protocol.md says. Run the tests with ./check.sh.

import { createHash, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign as nodeSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const BUILT = fileURLToPath(new URL("../build/test/entry.js", import.meta.url));

export const ORIGIN = "https://sync.example.workers.dev";
export const SETUP = "ABCDEFGHJKLMNPQRSTUVWXYZ23";
/** A fixed clock, so that every test sees the same days. 2026-11-02T10:00:00Z. */
export const NOW = 1_793_613_600_000;
export const MINUTE = 60_000;
export const DAY = 86_400_000;

// Answer bytes.
export const DONE = 0x00;
export const NOT_THIS_VERSION = 0x01;
export const NOT_A_DEVICE = 0x02;
export const REMOVED = 0x03;
export const DOES_NOT_CHECK = 0x04;
export const CLOCK = 0x05;
export const CLOSED = 0x06;
export const WRITES_USED = 0x07;
export const FULL = 0x08;
export const WRONG_CODE = 0x09;
export const OTHER_ACCOUNT = 0x0a;
export const OTHER_EPOCH = 0x0b;
export const TOO_MUCH = 0x0c;

/** The Miniflare options of the test Worker, with a SETUP_CODE or none. */
function options(setupCode) {
  const env = { DB: { type: "d1" }, FILES: { type: "r2" } };
  if (setupCode !== null) env.SETUP_CODE = { type: "text", value: setupCode };
  return {
    workers: [
      {
        config: {
          name: "test",
          compatibilityDate: "2026-10-01",
          manifest: {
            mainModule: "entry.js",
            modules: { "entry.js": { type: "esm", contents: readFileSync(BUILT, "utf8") } },
          },
          env,
        },
      },
    ],
  };
}

/** Starts a fresh server. Call `stop()` at the end of the test. */
export async function startServer({ setupCode = SETUP } = {}) {
  const mf = new Miniflare(options(setupCode));
  const server = {
    mf,
    now: NOW,
    async stop() {
      await mf.dispose();
    },
    /** The user saves another SETUP_CODE in the dashboard. */
    async saveSetupCode(code) {
      await mf.setOptions(options(code));
    },
    /** Sends a request. Gives the answer: its status, its bytes and the row writes. */
    async send(method, pathAndQuery, { body, headers = {}, now = server.now, url = ORIGIN } = {}) {
      const response = await mf.dispatchFetch(url + pathAndQuery, {
        method,
        body: body === undefined ? undefined : Buffer.from(body),
        headers: { "shk-test-now": String(now), ...headers },
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        bytes,
        answer: bytes[0],
        rowWrites: Number(response.headers.get("shk-test-row-writes")),
        reader: new Reader(bytes.subarray(1)),
      };
    },
    async info() {
      const answer = await server.send("GET", "/v1/info");
      const r = answer.reader;
      return {
        ...answer,
        lowest: r.u8(),
        highest: r.u8(),
        id: r.take(16),
        clock: r.i64(),
        state: r.u8(),
        mostRecords: r.u32(),
        mostBytes: r.u32(),
        mostFileItems: r.u32(),
      };
    },
    db() {
      return mf.getD1Database("DB");
    },
    files() {
      return mf.getR2Bucket("FILES");
    },
    /** Runs SQL straight on the server's database, as a user could in the dashboard. */
    async sql(query, ...values) {
      const db = await mf.getD1Database("DB");
      return (await db.prepare(query).bind(...values).all()).results;
    },
  };
  return server;
}

/** Runs a test body with a fresh server, and stops it afterwards. */
export async function withServer(body, options) {
  const server = await startServer(options);
  try {
    await body(server);
  } finally {
    await server.stop();
  }
}

// --- Bytes ------------------------------------------------------------------

/** Reads an answer body. */
export class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }
  u8() {
    return this.view.getUint8(this.offset++);
  }
  u16() {
    const v = this.view.getUint16(this.offset);
    this.offset += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.offset);
    this.offset += 4;
    return v;
  }
  i64() {
    const v = Number(this.view.getBigInt64(this.offset));
    this.offset += 8;
    return v;
  }
  take(n) {
    const v = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  get remaining() {
    return this.bytes.byteLength - this.offset;
  }
}

/** Builds a request body. */
export class Writer {
  constructor() {
    this.parts = [];
  }
  u8(v) {
    this.parts.push(Uint8Array.of(v));
    return this;
  }
  u16(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v);
    this.parts.push(b);
    return this;
  }
  u32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v);
    this.parts.push(b);
    return this;
  }
  i64(v) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(v));
    this.parts.push(b);
    return this;
  }
  bytes(b) {
    this.parts.push(Uint8Array.from(b));
    return this;
  }
  finish() {
    return concat(this.parts);
  }
}

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

export const hex = (bytes) => Buffer.from(bytes).toString("hex");
export const unhex = (text) => new Uint8Array(Buffer.from(text, "hex"));
export const ascii = (text) => new Uint8Array(Buffer.from(text, "ascii"));
export const sha256 = (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest());
export const random = (n) => new Uint8Array(randomBytes(n));

// --- Keys and signatures ----------------------------------------------------

/** A device: a P-256 key pair, as the Sync app's Keystore would make it. */
export async function newDevice() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  return deviceFrom(keys.privateKey, publicKey);
}

/** A device from a key that the caller made. */
export function deviceFrom(privateKey, publicKey) {
  return {
    publicKey,
    id: sha256(publicKey).subarray(0, 16),
    async sign(bytes) {
      return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, bytes));
    },
  };
}

const ED25519_PKCS8_START = unhex("302e020100300506032b657004220420");

/** An account key from 32 private bytes, as RFC 8032 defines it. */
export function accountFrom(seed, keyId) {
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_START, seed]), format: "der", type: "pkcs8" });
  const publicKey = new Uint8Array(createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32));
  return {
    publicKey,
    keyId,
    sign: (bytes) => new Uint8Array(nodeSign(null, bytes, key)),
  };
}

/** The account key of a recovery key: HKDF-SHA256 with the label `shkriuss.app/v1/sync/account`. */
export function accountOfRecoveryKey(recoveryKey, keyId) {
  const seed = new Uint8Array(hkdfSync("sha256", recoveryKey, new Uint8Array(0), "shkriuss.app/v1/sync/account", 32));
  return accountFrom(seed, keyId);
}

/** A new account with a random recovery key. */
export function newAccount() {
  return accountOfRecoveryKey(random(32), random(4));
}

/** The bytes of a statement. */
export function statementBytes({ type, serverId, keyId, time, address = ORIGIN, body }) {
  return new Writer()
    .bytes(ascii("SHKSYNC"))
    .u8(0x01)
    .u8(type)
    .bytes(serverId)
    .bytes(keyId)
    .i64(time)
    .u8(address.length)
    .bytes(ascii(address))
    .bytes(body)
    .finish();
}

/** The bytes a device key signs for a request. */
export function requestBytes({ serverId, deviceId, time, method, pathAndQuery, bodyHash }) {
  return new Writer()
    .bytes(ascii("SHKSYNC"))
    .u8(0x01)
    .u8(0x10)
    .bytes(serverId)
    .bytes(deviceId)
    .i64(time)
    .u8(method === "GET" ? 0x01 : 0x02)
    .u16(pathAndQuery.length)
    .bytes(ascii(pathAndQuery))
    .bytes(bodyHash)
    .finish();
}

/**
 * Sends a request signed by a device. `signedPart` is the part of the
 * body the signature covers; the whole body unless given.
 */
export async function signed(server, serverId, device, method, pathAndQuery, options = {}) {
  const body = options.body ?? new Uint8Array(0);
  const time = options.time ?? server.now;
  const bytes = requestBytes({
    serverId,
    deviceId: options.signAsId ?? device.id,
    time: options.signedTime ?? time,
    method: options.signedMethod ?? method,
    pathAndQuery: options.signedPathAndQuery ?? pathAndQuery,
    bodyHash: sha256(options.signedPart ?? body),
  });
  const signature = options.signature ?? (await device.sign(bytes));
  return server.send(method, pathAndQuery, {
    body: method === "GET" && body.byteLength === 0 ? undefined : body,
    now: options.now ?? server.now,
    headers: {
      "shk-device": options.deviceHeader ?? hex(device.id),
      "shk-time": String(time),
      "shk-signature": hex(signature),
      ...(options.headers ?? {}),
    },
  });
}

/** A sealed name of a device: a blob of kind 1 of the given length. The server never opens it. */
export function sealedName(length = 60) {
  const name = random(length);
  name.set([0x53, 0x48, 0x4b, 0x01, 0x01, 0x01], 0);
  return name;
}

/** The body of `enrol`. */
export function enrolBody({ kind, code, statement, signature, accountPublicKey, name = sealedName() }) {
  return new Writer()
    .u8(kind)
    .u8(code.length)
    .bytes(code)
    .u16(statement.length)
    .bytes(statement)
    .bytes(signature)
    .bytes(accountPublicKey)
    .u16(name.length)
    .bytes(name)
    .finish();
}

/**
 * Joins a device: it gets a statement signed by the account key, and
 * sends `enrol` with the code. Gives the answer.
 */
export async function join(server, serverId, account, device, { kind = 0x02, code = ascii(SETUP), ...options } = {}) {
  const statement = statementBytes({
    type: 0x01,
    serverId: options.statementServerId ?? serverId,
    keyId: options.statementKeyId ?? account.keyId,
    time: options.statementTime ?? server.now,
    address: options.address ?? ORIGIN,
    body: device.publicKey,
  });
  const body = enrolBody({
    kind,
    code,
    statement,
    signature: options.statementSignature ?? account.sign(statement),
    accountPublicKey: account.publicKey,
    name: options.name,
  });
  return signed(server, serverId, device, "POST", "/v1/enrol", { body, ...options });
}

/**
 * A server in use: one account, one device joined with the setup code.
 * Gives what a test needs to go on.
 */
export async function serverInUse(server) {
  const { id } = await server.info();
  const account = newAccount();
  const device = await newDevice();
  const answer = await join(server, id, account, device);
  if (answer.answer !== DONE) throw new Error(`join failed with ${answer.answer}`);
  const epoch = answer.reader.take(16);
  return { serverId: id, account, device, epoch };
}

/** A second device, joined with a device code that the first one asks for. */
export async function joinAnother(server, setup) {
  const code = await signed(server, setup.serverId, setup.device, "POST", "/v1/enrol-code");
  if (code.answer !== DONE) throw new Error(`enrol-code failed with ${code.answer}`);
  const device = await newDevice();
  const answer = await join(server, setup.serverId, setup.account, device, { kind: 0x01, code: code.reader.take(8) });
  if (answer.answer !== DONE) throw new Error(`join failed with ${answer.answer}`);
  return device;
}

// --- Records and batches ----------------------------------------------------

/** A sealed record as the server sees it: its first six bytes, a key ID, and bytes it cannot open. */
export function sealedRecord(keyId, length = 120) {
  const blob = random(length);
  blob.set([0x53, 0x48, 0x4b, 0x01, 0x01, 0x01], 0);
  blob.set(keyId, 6);
  return blob;
}

/** The body of a batch. */
export function batchBody({ epoch, cursor = 0, known = 0, comparison = false, records }) {
  const w = new Writer().bytes(epoch).i64(cursor).i64(known).u8(comparison ? 1 : 0).u32(records.length);
  for (const record of records) w.bytes(record.id).u32(record.blob.length).bytes(record.blob);
  return w.finish();
}

/** Sends a batch. Gives the answer with its results read. */
export async function send(server, setup, device, app, batch, headers = {}) {
  const answer = await signed(server, setup.serverId, device, "POST", `/v1/changes?app=${app}`, {
    body: batchBody({ epoch: setup.epoch, ...batch }),
    headers,
  });
  if (answer.answer !== DONE) return answer;
  const r = answer.reader;
  const epoch = r.take(16);
  const headBefore = r.i64();
  const headAfter = r.i64();
  const results = [];
  for (let i = r.u32(); i > 0; i--) {
    const result = r.u8();
    results.push(result === 0x00 || result === 0x04 ? { result, number: r.i64() } : { result });
  }
  return { ...answer, epoch, headBefore, headAfter, results };
}

/** Fetches a page. Gives the answer with its records read. */
export async function fetchPage(server, setup, device, app, { since = 0, known = 0, epoch = setup.epoch, most = 100 } = {}) {
  const query = `/v1/changes?app=${app}&since=${since}&known=${known}&epoch=${hex(epoch)}&most=${most}`;
  const answer = await signed(server, setup.serverId, device, "GET", query);
  if (answer.answer !== DONE) return answer;
  const r = answer.reader;
  const page = { ...answer, epoch: r.take(16), since: r.i64(), through: r.i64(), more: r.u8(), records: [] };
  for (let i = r.u32(); i > 0; i--) {
    const id = r.take(16);
    const number = r.i64();
    page.records.push({ id, number, blob: r.take(r.u32()) });
  }
  return page;
}

/** Reads `heads`. */
export async function readHeads(server, setup, device, headers = {}) {
  const answer = await signed(server, setup.serverId, device, "GET", "/v1/heads", { headers });
  if (answer.answer !== DONE) return answer;
  const r = answer.reader;
  const heads = { ...answer, epoch: r.take(16), keyId: r.take(4), revision: r.i64(), apps: {} };
  for (let i = r.u8(); i > 0; i--) {
    const name = Buffer.from(r.take(r.u8())).toString("ascii");
    heads.apps[name] = { head: r.i64(), told: r.i64() };
  }
  return heads;
}

/** Reads `devices`. */
export async function readDevices(server, setup, device) {
  const answer = await signed(server, setup.serverId, device, "GET", "/v1/devices");
  if (answer.answer !== DONE) return answer;
  const r = answer.reader;
  const list = [];
  for (let i = r.u16(); i > 0; i--) {
    list.push({
      id: r.take(16),
      publicKey: r.take(65),
      state: r.u8(),
      added: r.i64(),
      seenDay: r.i64(),
      name: r.take(r.u16()),
    });
  }
  return { ...answer, list };
}
