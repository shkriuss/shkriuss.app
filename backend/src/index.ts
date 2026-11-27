// The sync server: one Cloudflare Worker with a D1 database and an R2
// bucket, in the user's own Cloudflare account. It stores only
// ciphertext and is never trusted. What it does, byte by byte:
// docs/architecture/sync-protocol.md.
//
// Licensed AGPL-3.0, see backend/LICENSE.

import { handle } from "./server";

/** The bindings of the Worker, as wrangler.jsonc names them. */
export interface Env {
  /** The sealed records, the devices and the rest of the server's state. */
  readonly DB: D1Database;
  /** The file chunks. */
  readonly FILES: R2Bucket;
  /** The setup code the user saves in the Cloudflare dashboard, if any. */
  readonly SETUP_CODE?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, {
      db: env.DB,
      files: env.FILES,
      setupCode: env.SETUP_CODE,
      origin: new URL(request.url).origin.toLowerCase(),
      now: () => Date.now(),
      random: (length) => crypto.getRandomValues(new Uint8Array(length)),
    });
  },
} satisfies ExportedHandler<Env>;
