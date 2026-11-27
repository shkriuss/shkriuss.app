// The list of devices, removing and renaming one, and `heads`
// (sync-protocol.md: `devices`, `heads`, "The list of devices",
// "Removing a device").

import { DONE } from "../answers";
import { LayoutError, Reader, Writer, fromD1Hex, sameBytes } from "../bytes";
import type { SignedCall } from "../call";
import { DAY_MS, SEALED_NAME_MAX, SEALED_NAME_MIN } from "../limits";
import { readQuery } from "../request";
import {
  ALL_DEVICES,
  DEVICE_IN,
  DEVICE_REMOVED,
  deviceStillIn,
  guard,
  run,
  serverUnchanged,
  toDeviceRow,
} from "../store";

/** `GET /v1/devices`: every device of the server, also the removed ones. */
export async function devices(call: SignedCall): Promise<Uint8Array> {
  readQuery(call.url, []);
  const db = call.context.db;
  const [result] = await run(db, [db.prepare(ALL_DEVICES)]);
  const rows = (result?.results ?? []).map(toDeviceRow);
  if (rows.length > 0xffff) throw new Error("too many devices");
  const writer = new Writer().u8(DONE).u16(rows.length);
  for (const device of rows) {
    writer
      .bytes(device.id)
      .bytes(device.publicKey)
      .u8(device.state)
      .i64(device.added)
      .i64(device.seenDay * DAY_MS)
      .u16(device.name.byteLength)
      .bytes(device.name);
  }
  return writer.finish();
}

/**
 * `POST /v1/devices/remove`: any device removes another, or itself. A
 * removed key never joins again. The answer carries the account revision.
 */
export async function removeDevice(call: SignedCall): Promise<Uint8Array> {
  const { context, server, device, body } = call;
  readQuery(call.url, []);
  const reader = new Reader(body);
  const target = reader.take(16);
  reader.end();
  const db = context.db;
  const [found] = await run(db, [db.prepare("SELECT state FROM device WHERE id = unhex(?1)").bind(target.toHex())]);
  const state = found?.results[0]?.["state"];
  // Removing a device that is removed already, or that the server does
  // not know, changes nothing.
  if (state === undefined || Number(state) !== DEVICE_IN) {
    return new Writer().u8(DONE).i64(server.revision).finish();
  }
  await run(db, [
    serverUnchanged(db, server),
    deviceStillIn(db, device.id),
    guard(db, `(SELECT state FROM device WHERE id = unhex(?1)) = ${DEVICE_IN}`, target.toHex()),
    db.prepare(`UPDATE device SET state = ${DEVICE_REMOVED} WHERE id = unhex(?1)`).bind(target.toHex()),
    db.prepare("UPDATE server SET revision = revision + 1 WHERE one = 1"),
  ]);
  return new Writer().u8(DONE).i64(server.revision + 1).finish();
}

/** `POST /v1/devices/name`: the calling device gets a new sealed name. */
export async function renameDevice(call: SignedCall): Promise<Uint8Array> {
  const { context, server, device, body } = call;
  readQuery(call.url, []);
  const reader = new Reader(body);
  const length = reader.u16();
  if (length < SEALED_NAME_MIN || length > SEALED_NAME_MAX) throw new LayoutError("name length");
  const name = reader.take(length);
  reader.end();
  // The same name again changes nothing.
  if (sameBytes(name, device.name)) return new Writer().u8(DONE).i64(server.revision).finish();
  const db = context.db;
  await run(db, [
    serverUnchanged(db, server),
    deviceStillIn(db, device.id),
    db.prepare("UPDATE device SET name = unhex(?1) WHERE id = unhex(?2)").bind(name.toHex(), device.id.toHex()),
    db.prepare("UPDATE server SET revision = revision + 1 WHERE one = 1"),
  ]);
  return new Writer().u8(DONE).i64(server.revision + 1).finish();
}

/**
 * `GET /v1/heads`: the check a device makes when it has nothing to send.
 * The epoch, the current key ID, the account revision, and for each app
 * its head and the highest number the server told this device.
 */
export async function heads(call: SignedCall): Promise<Uint8Array> {
  const { context, device } = call;
  readQuery(call.url, []);
  const db = context.db;
  const [serverResult, appResult, toldResult] = await run(db, [
    db.prepare("SELECT hex(epoch) AS epoch, hex(key_id) AS key_id, revision FROM server WHERE one = 1"),
    db.prepare("SELECT name, head FROM app ORDER BY name"),
    db.prepare("SELECT app, number FROM told WHERE device = unhex(?1)").bind(device.id.toHex()),
  ]);
  const server = serverResult?.results[0];
  if (server === undefined) throw new Error("the server's row is missing");
  const apps = appResult?.results ?? [];
  if (apps.length > 0xff) throw new Error("too many apps");
  const told = new Map<string, number>();
  for (const row of toldResult?.results ?? []) told.set(String(row["app"]), Number(row["number"]));
  const writer = new Writer()
    .u8(DONE)
    .bytes(fromD1Hex(server["epoch"]))
    .bytes(fromD1Hex(server["key_id"]))
    .i64(Number(server["revision"]))
    .u8(apps.length);
  for (const app of apps) {
    const name = String(app["name"]);
    writer
      .u8(name.length)
      .bytes(new TextEncoder().encode(name))
      .i64(Number(app["head"]))
      .i64(told.get(name) ?? 0);
  }
  return writer.finish();
}
