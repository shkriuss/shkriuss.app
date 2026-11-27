// `GET /v1/info`: not signed. Anyone who knows the address can ask.

import { DONE } from "../answers";
import { Writer } from "../bytes";
import { HIGHEST_VERSION, LOWEST_VERSION, MOST_BYTES, MOST_FILE_ITEMS, MOST_RECORDS } from "../limits";
import { openServer, type Context } from "../store";

/** The versions, the server ID, the clock, the state and the three limits. */
export async function info(context: Context): Promise<Uint8Array> {
  const { server } = await openServer(context, null);
  return new Writer()
    .u8(DONE)
    .u8(LOWEST_VERSION)
    .u8(HIGHEST_VERSION)
    .bytes(server.id)
    .i64(context.now())
    .u8(server.state)
    .u32(MOST_RECORDS)
    .u32(MOST_BYTES)
    .u32(MOST_FILE_ITEMS)
    .finish();
}
