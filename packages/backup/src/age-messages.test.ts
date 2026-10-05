import { describe, expect, it } from "vitest";
import { isAgeRequest, isAgeResponse } from "./age-messages.ts";

const bytes = new Uint8Array([1, 2, 3]);

describe("isAgeRequest", () => {
  it.each<[string, unknown]>([
    ["an encryption", { operation: "encrypt", bytes, passphrase: "a passphrase" }],
    ["a decryption", { operation: "decrypt", bytes, passphrase: "" }],
  ])("accepts %s", (_case, value) => {
    expect(isAgeRequest(value)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "encrypt"],
    ["an empty object", {}],
    ["another operation", { operation: "sign", bytes, passphrase: "" }],
    ["no bytes", { operation: "encrypt", passphrase: "" }],
    ["bytes in an array", { operation: "encrypt", bytes: [1, 2, 3], passphrase: "" }],
    ["no passphrase", { operation: "encrypt", bytes }],
    ["a passphrase that is not a string", { operation: "encrypt", bytes, passphrase: 1 }],
  ])("refuses %s", (_case, value) => {
    expect(isAgeRequest(value)).toBe(false);
  });
});

describe("isAgeResponse", () => {
  it.each<[string, unknown]>([
    ["bytes", { ok: true, bytes }],
    ["a failure with a code", { ok: false, code: "damaged", message: "Damaged." }],
    ["an unexpected failure", { ok: false, code: null, message: "Failed." }],
  ])("accepts %s", (_case, value) => {
    expect(isAgeResponse(value)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "ok"],
    ["an empty object", {}],
    ["ok that is not a boolean", { ok: "true", bytes }],
    ["no bytes", { ok: true }],
    ["bytes in an array", { ok: true, bytes: [1, 2, 3] }],
    ["bytes on shared memory", { ok: true, bytes: new Uint8Array(new SharedArrayBuffer(3)) }],
    ["no code", { ok: false, message: "Failed." }],
    ["an unknown code", { ok: false, code: "unknown", message: "Failed." }],
    ["no message", { ok: false, code: null }],
    ["a message that is not a string", { ok: false, code: null, message: 1 }],
  ])("refuses %s", (_case, value) => {
    expect(isAgeResponse(value)).toBe(false);
  });
});
