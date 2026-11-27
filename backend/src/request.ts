// What a request carries besides its body: the three headers of a signed
// request, and the query. Each is read strictly, so that a request is
// either exactly of its layout or answered `04`.

import { LayoutError, fromHex } from "./bytes";
import { SIGNATURE_LENGTH } from "./signatures";

/** The headers `shk-device`, `shk-time` and `shk-signature`. */
export interface SignedHeaders {
  readonly deviceId: Uint8Array;
  readonly time: bigint;
  readonly signature: Uint8Array;
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** The headers of a signed request, or null if one is missing or not of its layout. */
export function readSignedHeaders(request: Request): SignedHeaders | null {
  const deviceId = fromHex(request.headers.get("shk-device") ?? "", 16);
  const signature = fromHex(request.headers.get("shk-signature") ?? "", SIGNATURE_LENGTH);
  const timeText = request.headers.get("shk-time") ?? "";
  if (deviceId === null || signature === null || !/^-?[0-9]{1,19}$/.test(timeText)) return null;
  const time = BigInt(timeText);
  if (time < INT64_MIN || time > INT64_MAX) return null;
  return { deviceId, time, signature };
}

/** A body longer than its call allows. The answer is `0C`, once the checks before it pass. */
export const TOO_LONG = Symbol("too long");

/** Reads a body, but stops at `most` bytes. */
export async function readBody(request: Request, most: number): Promise<Uint8Array | typeof TOO_LONG> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > most) return TOO_LONG;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > most) {
      await reader.cancel();
      return TOO_LONG;
    }
    parts.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

/**
 * The query of a call: exactly the names given, each once, in any order,
 * each value of lower-case letters and digits only.
 */
export function readQuery(url: URL, names: readonly string[]): Map<string, string> {
  const search = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  const values = new Map<string, string>();
  if (search.length === 0) {
    if (names.length === 0) return values;
    throw new LayoutError("query missing");
  }
  for (const pair of search.split("&")) {
    const match = /^([a-z]+)=([a-z0-9]+)$/.exec(pair);
    if (match === null) throw new LayoutError("query layout");
    const [, name, value] = match;
    if (name === undefined || value === undefined || !names.includes(name) || values.has(name)) {
      throw new LayoutError("query names");
    }
    values.set(name, value);
  }
  if (values.size !== names.length) throw new LayoutError("query names");
  return values;
}

/** An app name: 1 to 32 lower-case letters `a` to `z`. */
export function appName(value: string | undefined): string {
  if (value === undefined || !/^[a-z]{1,32}$/.test(value)) throw new LayoutError("app name");
  return value;
}

/** A decimal number of the query that may not be negative. Very large ones count as the largest. */
export function decimal(value: string | undefined): number {
  if (value === undefined || !/^[0-9]{1,19}$/.test(value)) throw new LayoutError("number");
  const number = BigInt(value);
  if (number > INT64_MAX) throw new LayoutError("number");
  return number > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(number);
}
