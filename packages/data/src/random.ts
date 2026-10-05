/** A source of random bytes. Tests pass their own; everything else uses `crypto.getRandomValues`. */
export type RandomBytes = (length: number) => Uint8Array;

export const randomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** Bytes as lowercase hexadecimal digits. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
