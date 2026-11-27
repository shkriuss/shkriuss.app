// What a call gets from the router, and the clock check that both the
// router and `enrol` make.

import { CLOCK, Refusal } from "./answers";
import { Writer } from "./bytes";
import { CLOCK_WINDOW_MS } from "./limits";
import type { SignedHeaders, TOO_LONG } from "./request";
import type { Context, DeviceRow, ServerRow } from "./store";

/** What a call gets once its request has passed every check of a signed request. */
export interface SignedCall {
  readonly context: Context;
  readonly server: ServerRow;
  /** The device that signed the request. It is in. */
  readonly device: DeviceRow;
  readonly body: Uint8Array;
  readonly url: URL;
}

/** What `enrol` gets: it makes its own checks, in the order of "Joining". */
export interface EnrolCall {
  readonly context: Context;
  readonly server: ServerRow;
  /** The device the headers name, if the server knows it. */
  readonly device: DeviceRow | null;
  readonly headers: SignedHeaders;
  readonly body: Uint8Array | typeof TOO_LONG;
  readonly url: URL;
}

/** The answer `05` when a request's time is more than 5 minutes from the server's clock. */
export function checkClock(time: bigint, now: number): void {
  const difference = time - BigInt(now);
  if (difference > BigInt(CLOCK_WINDOW_MS) || difference < -BigInt(CLOCK_WINDOW_MS)) {
    throw new Refusal(CLOCK, new Writer().i64(now).finish());
  }
}
