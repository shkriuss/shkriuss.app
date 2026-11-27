// The server interface, version 1: the router, and the checks every
// signed request passes before its call runs (sync-protocol.md, "Signed
// requests", point 2).

import {
  CLOSED,
  DOES_NOT_CHECK,
  NOT_A_DEVICE,
  REMOVED,
  Refusal,
  TOO_MUCH,
  notThisVersion,
  refusalBody,
  respond,
} from "./answers";
import { LayoutError, sha256 } from "./bytes";
import { checkClock, type SignedCall } from "./call";
import { DAY_MS, MOST_BODY_BYTES, MOST_FILES_SEND_BODY_BYTES } from "./limits";
import { TOO_LONG, readBody, readSignedHeaders, type SignedHeaders } from "./request";
import { METHOD_GET, METHOD_POST, deviceSigned, requestBytes } from "./signatures";
import {
  CLOSED_STATE,
  DEVICE_REMOVED,
  GuardFailed,
  openServer,
  run,
  type Context,
  type DeviceRow,
  type ServerRow,
} from "./store";
import { accountDelete, accountKey, enrol, enrolCode } from "./calls/account";
import { fetchChanges, sendChanges } from "./calls/changes";
import { devices, heads, removeDevice, renameDevice } from "./calls/devices";
import { filesDelete, filesFetch, filesHave, filesSend, filesSendSignedPart } from "./calls/files";
import { info } from "./calls/info";

interface Call {
  readonly mostBody?: number;
  /** The part of the body the signature covers. The whole body, unless given. */
  readonly signedPart?: (body: Uint8Array) => Uint8Array;
  readonly run: (call: SignedCall) => Promise<Uint8Array>;
}

const CALLS = new Map<string, Call>([
  ["POST /v1/enrol-code", { run: enrolCode }],
  ["GET /v1/devices", { run: devices }],
  ["POST /v1/devices/remove", { run: removeDevice }],
  ["POST /v1/devices/name", { run: renameDevice }],
  ["GET /v1/heads", { run: heads }],
  ["GET /v1/changes", { run: fetchChanges }],
  ["POST /v1/changes", { run: sendChanges }],
  ["POST /v1/files/send", { run: filesSend, signedPart: filesSendSignedPart, mostBody: MOST_FILES_SEND_BODY_BYTES }],
  ["POST /v1/files/have", { run: filesHave }],
  ["POST /v1/files/fetch", { run: filesFetch }],
  ["POST /v1/files/delete", { run: filesDelete }],
  ["POST /v1/account-key", { run: accountKey }],
  ["POST /v1/account/delete", { run: accountDelete }],
]);

/** How often a call starts again when its guard finds that the state changed. */
const ATTEMPTS = 3;

/**
 * Answers one request. Every answer of the Worker has HTTP status 200 and
 * starts with an answer byte. A fault of the Worker itself is HTTP 500
 * with no body, which a device treats as "not from the Worker". Nothing
 * is logged (sync-protocol.md, Rules, point 10).
 */
export async function handle(request: Request, context: Context): Promise<Response> {
  try {
    return respond(await answer(request, context));
  } catch (error) {
    if (error instanceof Refusal) return respond(refusalBody(error));
    if (error instanceof LayoutError) return respond(Uint8Array.of(DOES_NOT_CHECK));
    return new Response(null, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

async function answer(request: Request, context: Context): Promise<Uint8Array> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/")) throw notThisVersion();
  if (url.pathname === "/v1/info") {
    if (request.method !== "GET") throw new LayoutError("method");
    return info(context);
  }
  const isEnrol = request.method === "POST" && url.pathname === "/v1/enrol";
  const call = CALLS.get(`${request.method} ${url.pathname}`) ?? null;
  const headers = readSignedHeaders(request);
  const body = await readBody(request, call?.mostBody ?? MOST_BODY_BYTES);
  for (let attempt = 1; ; attempt++) {
    try {
      const { server, device } = await openServer(context, headers?.deviceId ?? null);
      // A closed server answers 06 to everything but info, without
      // checking who asks.
      if (server.state === CLOSED_STATE) throw new Refusal(CLOSED);
      if (headers === null || (call === null && !isEnrol)) throw new LayoutError("no such call");
      if (isEnrol) return await enrol({ context, server, device, headers, body, url });
      if (call === null) throw new LayoutError("no such call");
      const signed = await checkSigned(request, context, server, device, headers, body, url, call);
      return await call.run(signed);
    } catch (error) {
      if (!(error instanceof GuardFailed) || attempt === ATTEMPTS) throw error;
    }
  }
}

/** The checks of a signed request, in their order: the device, the clock, then the signature. */
async function checkSigned(
  request: Request,
  context: Context,
  server: ServerRow,
  device: DeviceRow | null,
  headers: SignedHeaders,
  body: Uint8Array | typeof TOO_LONG,
  url: URL,
  call: Call,
): Promise<SignedCall> {
  if (device === null) throw new Refusal(NOT_A_DEVICE);
  if (device.state === DEVICE_REMOVED) throw new Refusal(REMOVED);
  checkClock(headers.time, context.now());
  if (body === TOO_LONG) throw new Refusal(TOO_MUCH);
  const method = request.method === "GET" ? METHOD_GET : METHOD_POST;
  if (method === METHOD_GET && body.byteLength > 0) throw new LayoutError("a GET has no body");
  const signedPart = call.signedPart ? call.signedPart(body) : body;
  const bytes = requestBytes({
    serverId: server.id,
    deviceId: device.id,
    time: headers.time,
    method,
    pathAndQuery: url.pathname + url.search,
    bodyHash: await sha256(signedPart),
  });
  if (!(await deviceSigned(device.publicKey, bytes, headers.signature))) throw new LayoutError("signature");
  await noteDaySeen(context, device);
  return { context, server, device, body, url };
}

/** The day a device was last seen is written once on each day it calls. */
async function noteDaySeen(context: Context, device: DeviceRow): Promise<void> {
  const today = Math.floor(context.now() / DAY_MS);
  if (device.seenDay >= today) return;
  const db = context.db;
  await run(db, [
    db
      .prepare("UPDATE device SET seen_day = ?1 WHERE id = unhex(?2) AND seen_day < ?1")
      .bind(today, device.id.toHex()),
  ]);
}
