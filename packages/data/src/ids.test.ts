import { describe, expect, it } from "vitest";
import { DataLayerError } from "./errors.ts";
import { SETTINGS_ID, isRecordId, newRecordId } from "./ids.ts";

describe("newRecordId", () => {
  it("writes the time into the first 48 bits, then the version, variant and random bits", () => {
    expect(newRecordId(0x01_23_45_67_89_ab, (length) => new Uint8Array(length).fill(0xff))).toBe(
      "01234567-89ab-7fff-bfff-ffffffffffff",
    );
    expect(newRecordId(0x01_23_45_67_89_ab, (length) => new Uint8Array(length))).toBe(
      "01234567-89ab-7000-8000-000000000000",
    );
  });

  it("makes ids that sort by time and differ within the same millisecond", () => {
    const earlier = newRecordId(1_791_052_200_000);
    const later = newRecordId(1_791_052_200_001);
    expect(earlier < later).toBe(true);
    expect(isRecordId(earlier)).toBe(true);
    const ids = new Set(Array.from({ length: 1000 }, () => newRecordId(1_791_052_200_000)));
    expect(ids.size).toBe(1000);
  });

  it.each([-1, 2 ** 48, 1.5])("refuses the time %d", (now) => {
    expect(() => newRecordId(now)).toThrow(DataLayerError);
  });
});

describe("isRecordId (data model §2.1)", () => {
  it.each(["01a10307-b840-78aa-ab29-1a1138faaff6", SETTINGS_ID])("accepts %s", (id) => {
    expect(isRecordId(id)).toBe(true);
  });

  it.each([
    "01A10307-B840-78AA-AB29-1A1138FAAFF6",
    "01a10307-b840-48aa-ab29-1a1138faaff6",
    "01a10307-b840-78aa-cb29-1a1138faaff6",
    "01a10307b84078aaab291a1138faaff6",
    "{01a10307-b840-78aa-ab29-1a1138faaff6}",
    "01a10307-b840-78aa-ab29-1a1138faaff6\n",
    "",
    42,
    undefined,
  ])("refuses %j", (id) => {
    expect(isRecordId(id)).toBe(false);
  });
});
