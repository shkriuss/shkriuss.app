// Byte layouts: every request and answer body of the server interface is
// bytes in a fixed layout, big-endian (sync-protocol.md, Rules, point 8).

/** A body, a header or a query that does not have the layout of its call. The answer is `04`. */
export class LayoutError extends Error {
  constructor(what: string) {
    super(what);
    this.name = "LayoutError";
  }
}

/** Reads a body field by field, and refuses to read past its end. */
export class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** How many bytes have been read. */
  get position(): number {
    return this.offset;
  }

  /** How many bytes are left. */
  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  u8(): number {
    this.need(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  /**
   * A number of 8 bytes that may not be negative: a cursor or Known. Numbers
   * above what a JavaScript number holds exactly are taken as the largest
   * one, which is above every number the server ever gives.
   */
  count64(): number {
    this.need(8);
    const value = this.view.getBigInt64(this.offset);
    this.offset += 8;
    if (value < 0n) throw new LayoutError("negative number");
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
  }

  /** The next `length` bytes, as a view into the body. */
  take(length: number): Uint8Array {
    this.need(length);
    const part = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return part;
  }

  /** Fails unless every byte was read. */
  end(): void {
    if (this.remaining !== 0) throw new LayoutError("bytes left over");
  }

  private need(length: number): void {
    if (this.remaining < length) throw new LayoutError("cut");
  }
}

/** Puts an answer body together, field by field. */
export class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  u8(value: number): this {
    return this.bytes(Uint8Array.of(value));
  }

  u16(value: number): this {
    const part = new Uint8Array(2);
    new DataView(part.buffer).setUint16(0, value);
    return this.bytes(part);
  }

  u32(value: number): this {
    const part = new Uint8Array(4);
    new DataView(part.buffer).setUint32(0, value);
    return this.bytes(part);
  }

  /** A signed number of 8 bytes: a time or a number of the server. */
  i64(value: number): this {
    const part = new Uint8Array(8);
    new DataView(part.buffer).setBigInt64(0, BigInt(value));
    return this.bytes(part);
  }

  bytes(part: Uint8Array): this {
    this.parts.push(part);
    this.length += part.byteLength;
    return this;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }
}

/** Lower-case hex, as the protocol writes it. */
export function toHex(bytes: Uint8Array): string {
  return bytes.toHex();
}

/** Reads lower-case hex of exactly `length` bytes, or gives null. */
export function fromHex(text: string, length: number): Uint8Array | null {
  if (text.length !== length * 2 || !/^[0-9a-f]*$/.test(text)) return null;
  return Uint8Array.fromHex(text);
}

/** Bytes that come from D1 as hex, which D1 hands over far faster than a blob. */
export function fromD1Hex(text: unknown): Uint8Array {
  if (typeof text !== "string") throw new Error("expected hex from D1");
  return Uint8Array.fromHex(text);
}

/** Text of ASCII characters as bytes. */
export function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Whether two byte strings are the same. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

/** The SHA-256 of some bytes. */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
