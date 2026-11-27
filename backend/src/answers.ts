// The answer bytes of sync-protocol.md, "Answers". Every answer of the
// Worker has HTTP status 200 and a body that starts with one of them.

import { HIGHEST_VERSION, LOWEST_VERSION } from "./limits";

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

/** The two kinds of `07`: only a comparison of everything must wait, or all writes. */
export const WRITES_USED_FOR_COMPARISON = 0x01;
export const WRITES_USED_FOR_ALL = 0x02;

/**
 * Ends a call with an answer other than `00`. Thrown anywhere in a call,
 * and turned into the answer by the router.
 */
export class Refusal extends Error {
  constructor(
    readonly answer: number,
    readonly rest: Uint8Array = new Uint8Array(0),
  ) {
    super(`answer ${answer}`);
    this.name = "Refusal";
  }
}

/** The answer `01`, with the versions this server speaks. */
export function notThisVersion(): Refusal {
  return new Refusal(NOT_THIS_VERSION, Uint8Array.of(LOWEST_VERSION, HIGHEST_VERSION));
}

/** An answer body as the HTTP response. Never cached, never sniffed. */
export function respond(body: Uint8Array): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** The answer body of a refusal. */
export function refusalBody(refusal: Refusal): Uint8Array {
  const body = new Uint8Array(1 + refusal.rest.byteLength);
  body[0] = refusal.answer;
  body.set(refusal.rest, 1);
  return body;
}
