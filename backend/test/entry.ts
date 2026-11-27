// The Worker that the tests start: the server of src/, never deployed.
// It adds what only tests need, through request headers that the
// deployed Worker does not read:
// - `shk-test-now`: the server's clock, in milliseconds, for this request.
//   `shk-test-tick` moves it on by that many milliseconds at each look.
// - `shk-test-d1-error` with `shk-test-d1-error-at`: the D1 batches of
//   those numbers, counted from 1 and parted by commas, fail with that
//   message.
// The answer carries `shk-test-row-writes`: D1's own count of the rows
// that the request wrote.

import { handle } from "../src/server";
import type { Db } from "../src/store";

interface TestEnv {
  readonly DB: D1Database;
  readonly FILES: R2Bucket;
  readonly SETUP_CODE?: string;
}

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    let rowWrites = 0;
    let batches = 0;
    const failAt = (request.headers.get("shk-test-d1-error-at") ?? "").split(",").map(Number);
    const failWith = request.headers.get("shk-test-d1-error") ?? "";
    const db: Db = {
      prepare: (query) => env.DB.prepare(query),
      batch: async <T>(statements: D1PreparedStatement[]) => {
        batches += 1;
        if (failAt.includes(batches)) throw new Error(failWith);
        const results = await env.DB.batch<T>(statements);
        for (const result of results) rowWrites += result.meta.rows_written ?? 0;
        return results;
      },
    };
    const start = Number(request.headers.get("shk-test-now") ?? Date.now());
    const tick = Number(request.headers.get("shk-test-tick") ?? "0");
    let looks = 0;
    const response = await handle(request, {
      db,
      files: env.FILES,
      setupCode: env.SETUP_CODE,
      origin: new URL(request.url).origin.toLowerCase(),
      now: () => start + tick * looks++,
      random: (length) => crypto.getRandomValues(new Uint8Array(length)),
    });
    const headers = new Headers(response.headers);
    headers.set("shk-test-row-writes", String(rowWrites));
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<TestEnv>;
