// Joining, the codes, a new account key, and closing the server
// (sync-protocol.md: "Joining", `enrol`, `enrol-code`, `account-key`,
// `account/delete`).

import { DONE, OTHER_ACCOUNT, REMOVED, Refusal, WRONG_CODE } from "../answers";
import { LayoutError, Reader, Writer, ascii, fromD1Hex, sameBytes, sha256 } from "../bytes";
import {
  CODE_ALPHABET,
  CLOCK_WINDOW_MS,
  DAY_MS,
  DEVICE_CODE_LENGTH,
  DEVICE_CODE_LIFE_MS,
  DEVICE_CODE_TRIES,
  SEALED_NAME_MAX,
  SEALED_NAME_MIN,
  STATEMENT_LIFE_MS,
} from "../limits";
import { TOO_LONG, readQuery } from "../request";
import {
  ACCOUNT_PUBLIC_KEY_LENGTH,
  METHOD_POST,
  SIGNATURE_LENGTH,
  STATEMENT_JOIN,
  STATEMENT_NEW_ACCOUNT_KEY,
  accountSigned,
  deviceIdOf,
  deviceSigned,
  readStatement,
  requestBytes,
  type Statement,
} from "../signatures";
import { checkClock, type EnrolCall, type SignedCall } from "../call";
import {
  CLOSED_STATE,
  DEVICE_IN,
  IN_USE,
  NO_ACCOUNT,
  deviceStillIn,
  guard,
  run,
  serverUnchanged,
  type Context,
  type ServerRow,
} from "../store";

const DEVICE_CODE = 0x01;
const SETUP_CODE = 0x02;

interface EnrolBody {
  readonly kind: number;
  readonly code: Uint8Array;
  readonly statement: Uint8Array;
  readonly statementSignature: Uint8Array;
  readonly accountPublicKey: Uint8Array;
  readonly sealedName: Uint8Array;
}

function readEnrolBody(body: Uint8Array): EnrolBody {
  const reader = new Reader(body);
  const kind = reader.u8();
  if (kind !== DEVICE_CODE && kind !== SETUP_CODE) throw new LayoutError("kind of code");
  const code = reader.take(reader.u8());
  const statement = reader.take(reader.u16());
  const statementSignature = reader.take(SIGNATURE_LENGTH);
  const accountPublicKey = reader.take(ACCOUNT_PUBLIC_KEY_LENGTH);
  const nameLength = reader.u16();
  if (nameLength < SEALED_NAME_MIN || nameLength > SEALED_NAME_MAX) throw new LayoutError("name length");
  const sealedName = reader.take(nameLength);
  reader.end();
  return { kind, code, statement, statementSignature, accountPublicKey, sealedName };
}

/**
 * `POST /v1/enrol`: a device joins with its own key, a join statement and
 * a one-time code. The checks run in the order of "Joining", step 5, and
 * nothing is stored before the check of the code.
 */
export async function enrol(call: EnrolCall): Promise<Uint8Array> {
  const { context, server, headers, url } = call;
  const now = context.now();
  // 1. The server is not closed (the router), and the time.
  checkClock(headers.time, now);
  // No enrol body is near the limit, and 0C is not among enrol's answers.
  if (call.body === TOO_LONG) throw new LayoutError("enrol body too long");
  readQuery(url, []);
  const body = readEnrolBody(call.body);
  const statement = readStatement(body.statement);
  if (statement.type !== STATEMENT_JOIN || statement.devicePublicKey === null) {
    throw new LayoutError("not a join statement");
  }
  // 2. The request's own signature, with the device key the statement holds.
  const deviceId = await deviceIdOf(statement.devicePublicKey);
  if (!sameBytes(deviceId, headers.deviceId)) throw new LayoutError("another device");
  const signedBytes = requestBytes({
    serverId: server.id,
    deviceId,
    time: headers.time,
    method: METHOD_POST,
    pathAndQuery: url.pathname + url.search,
    bodyHash: await sha256(call.body),
  });
  if (!(await deviceSigned(statement.devicePublicKey, signedBytes, headers.signature))) {
    throw new LayoutError("signature");
  }
  // 3. The statement: this server, the address the request came to, and its time.
  checkStatementTarget(statement, server, context);
  if (statement.time < BigInt(now - STATEMENT_LIFE_MS) || statement.time > BigInt(now + CLOCK_WINDOW_MS)) {
    throw new LayoutError("statement too old");
  }
  // 4. The account key's signature on the statement.
  const accountKey = server.state === NO_ACCOUNT ? body.accountPublicKey : currentAccountKey(server, statement);
  if (!(await accountSigned(accountKey, body.statement, body.statementSignature))) {
    throw new LayoutError("statement signature");
  }
  // 5. A device that is in already gets 00 again, whatever its code.
  if (call.device !== null) {
    if (call.device.state === DEVICE_IN) return new Writer().u8(DONE).bytes(server.epoch).finish();
    throw new Refusal(REMOVED);
  }
  // 6. The code.
  const db = context.db;
  const codeWrites = await checkCode(context, server, body);
  // Then the device is stored, and on a server with no account the account key.
  await run(db, [
    serverUnchanged(db, server),
    guard(db, "NOT EXISTS (SELECT 1 FROM device WHERE id = unhex(?1))", deviceId.toHex()),
    ...codeWrites,
    db
      .prepare(
        `INSERT INTO device (id, public_key, name, state, added, seen_day)
         VALUES (unhex(?1), unhex(?2), unhex(?3), ${DEVICE_IN}, ?4, ?5)`,
      )
      .bind(
        deviceId.toHex(),
        statement.devicePublicKey.toHex(),
        body.sealedName.toHex(),
        now,
        Math.floor(now / DAY_MS),
      ),
    db
      .prepare(
        `UPDATE server SET state = ${IN_USE},
           account_key = coalesce(account_key, unhex(?1)),
           key_id = coalesce(key_id, unhex(?2)),
           revision = revision + 1
         WHERE one = 1`,
      )
      .bind(accountKey.toHex(), statement.signerKeyId.toHex()),
  ]);
  return new Writer().u8(DONE).bytes(server.epoch).finish();
}

/**
 * Checks the code, and gives the writes that use it up. A wrong device
 * code costs one of its tries. A server with no account takes only a
 * setup code.
 */
async function checkCode(context: Context, server: ServerRow, body: EnrolBody) {
  const db = context.db;
  const codeHash = await sha256(body.code);
  if (body.kind === SETUP_CODE) {
    const saved = context.setupCode?.trim() ?? "";
    const [used] = await run(db, [
      db.prepare("SELECT 1 AS used FROM used_setup_code WHERE hash = unhex(?1)").bind(codeHash.toHex()),
    ]);
    const matches = saved.length > 0 && sameBytes(codeHash, await sha256(ascii(saved)));
    if (!matches || used?.results[0] !== undefined) throw new Refusal(WRONG_CODE);
    return [
      guard(db, "NOT EXISTS (SELECT 1 FROM used_setup_code WHERE hash = unhex(?1))", codeHash.toHex()),
      db.prepare("INSERT INTO used_setup_code (hash) VALUES (unhex(?1))").bind(codeHash.toHex()),
    ];
  }
  if (server.state === NO_ACCOUNT) throw new Refusal(WRONG_CODE);
  const [codes] = await run(db, [db.prepare("SELECT hex(hash) AS hash, ends, tries FROM device_code WHERE one = 1")]);
  const row = codes?.results[0];
  const now = context.now();
  if (row === undefined || Number(row["tries"]) <= 0 || Number(row["ends"]) < now) {
    throw new Refusal(WRONG_CODE);
  }
  const storedHash = String(row["hash"]);
  if (!sameBytes(fromD1Hex(storedHash), codeHash)) {
    await run(db, [
      db
        .prepare("UPDATE device_code SET tries = tries - 1 WHERE one = 1 AND hash = unhex(?1) AND tries > 0")
        .bind(storedHash),
    ]);
    throw new Refusal(WRONG_CODE);
  }
  return [
    guard(
      db,
      "EXISTS (SELECT 1 FROM device_code WHERE one = 1 AND hash = unhex(?1) AND tries > 0 AND ends >= ?2)",
      storedHash,
      now,
    ),
    db.prepare("DELETE FROM device_code WHERE one = 1"),
  ];
}

/** A statement names this server by its ID and the address the request came to. */
function checkStatementTarget(statement: Statement, server: ServerRow, context: Context): void {
  if (!sameBytes(statement.serverId, server.id)) throw new LayoutError("another server");
  if (statement.address !== context.origin) throw new LayoutError("another address");
}

/** The stored account key, if the statement names the current key ID. Else `0A`. */
function currentAccountKey(server: ServerRow, statement: Statement): Uint8Array {
  if (server.accountKey === null || server.keyId === null) throw new Error("an account without a key");
  if (!sameBytes(statement.signerKeyId, server.keyId)) throw new Refusal(OTHER_ACCOUNT, server.keyId);
  return server.accountKey;
}

/**
 * `POST /v1/enrol-code`: a new device code of 8 characters, good for 10
 * minutes and 5 wrong tries. It voids the one before.
 */
export async function enrolCode(call: SignedCall): Promise<Uint8Array> {
  const { context, server, device, body, url } = call;
  readQuery(url, []);
  if (body.byteLength !== 0) throw new LayoutError("enrol-code has no body");
  const code = makeCode(context.random(DEVICE_CODE_LENGTH));
  const ends = context.now() + DEVICE_CODE_LIFE_MS;
  const db = context.db;
  await run(db, [
    serverUnchanged(db, server),
    deviceStillIn(db, device.id),
    db
      .prepare(
        `INSERT INTO device_code (one, hash, ends, tries) VALUES (1, unhex(?1), ?2, ?3)
         ON CONFLICT (one) DO UPDATE SET hash = excluded.hash, ends = excluded.ends, tries = excluded.tries`,
      )
      .bind((await sha256(ascii(code))).toHex(), ends, DEVICE_CODE_TRIES),
  ]);
  return new Writer().u8(DONE).bytes(ascii(code)).i64(ends).finish();
}

/** A code of the code letters. The alphabet has 32 letters, so 5 bits of a byte pick one evenly. */
export function makeCode(random: Uint8Array): string {
  let code = "";
  for (const byte of random) code += CODE_ALPHABET[byte & 31];
  return code;
}

/**
 * `POST /v1/account-key`: a statement, signed by the current account key,
 * names a new account key. The devices stay as they are.
 */
export async function accountKey(call: SignedCall): Promise<Uint8Array> {
  const { context, server, device, body, url } = call;
  readQuery(url, []);
  const reader = new Reader(body);
  const statementBytes = reader.take(reader.u16());
  const signature = reader.take(SIGNATURE_LENGTH);
  reader.end();
  const statement = readStatement(statementBytes);
  if (statement.type !== STATEMENT_NEW_ACCOUNT_KEY || statement.newAccountKey === null || statement.newKeyId === null) {
    throw new LayoutError("not a new account key statement");
  }
  checkStatementTarget(statement, server, context);
  // The same statement again, once the server took it: 00.
  if (
    server.accountKey !== null &&
    server.keyId !== null &&
    sameBytes(statement.newAccountKey, server.accountKey) &&
    sameBytes(statement.newKeyId, server.keyId)
  ) {
    return Uint8Array.of(DONE);
  }
  const signer = currentAccountKey(server, statement);
  if (!(await accountSigned(signer, statementBytes, signature))) throw new LayoutError("statement signature");
  const db = context.db;
  await run(db, [
    serverUnchanged(db, server),
    deviceStillIn(db, device.id),
    db
      .prepare("UPDATE server SET account_key = unhex(?1), key_id = unhex(?2), revision = revision + 1 WHERE one = 1")
      .bind(statement.newAccountKey.toHex(), statement.newKeyId.toHex()),
  ]);
  return Uint8Array.of(DONE);
}

/**
 * `POST /v1/account/delete`: closes the server for every device, in one
 * step, and deletes its devices, its codes and the account key. The
 * records and the chunks go when the user deletes the database and the
 * bucket in the Cloudflare dashboard.
 */
export async function accountDelete(call: SignedCall): Promise<Uint8Array> {
  const { context, server, device, body, url } = call;
  readQuery(url, []);
  if (!sameBytes(body, server.id)) throw new LayoutError("another server ID");
  const db = context.db;
  await run(db, [
    deviceStillIn(db, device.id),
    db.prepare("DELETE FROM device"),
    db.prepare("DELETE FROM told"),
    db.prepare("DELETE FROM device_code"),
    db.prepare("DELETE FROM used_setup_code"),
    db.prepare(`UPDATE server SET state = ${CLOSED_STATE}, account_key = NULL, key_id = NULL WHERE one = 1`),
  ]);
  return Uint8Array.of(DONE);
}
