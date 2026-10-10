import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataLayerError } from "./errors.ts";
import { SETTINGS_ID, isRecordId, newRecordId, recordIdIssuer } from "./ids.ts";
import { type RandomBytes, randomBytes } from "./random.ts";

const zeros: RandomBytes = (length) => new Uint8Array(length);
const ones: RandomBytes = (length) => new Uint8Array(length).fill(0xff);

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

describe("newRecordId, after the last id (RFC 9562, section 6.2)", () => {
  it("counts on in the 12 bits after the version within the same millisecond, and while the clock stands before the last id", () => {
    const first = newRecordId(0x01_23_45_67_89_ab, zeros);
    expect(first).toBe("01234567-89ab-7000-8000-000000000000");
    const second = newRecordId(0x01_23_45_67_89_ab, zeros, first);
    expect(second).toBe("01234567-89ab-7001-8000-000000000000");
    const back = newRecordId(0x01_23_45_67_89_aa, zeros, second);
    expect(back).toBe("01234567-89ab-7002-8000-000000000000");
    const later = newRecordId(0x01_23_45_67_89_ac, zeros, back);
    expect(later).toBe("01234567-89ac-7000-8000-000000000000");
  });

  it("draws the other bits afresh for each id", () => {
    const first = newRecordId(1_791_052_200_000);
    const second = newRecordId(1_791_052_200_000, randomBytes, first);
    expect(second.slice(0, 13)).toBe(first.slice(0, 13));
    expect(second > first).toBe(true);
    expect(second.slice(19)).not.toBe(first.slice(19));
  });

  it("moves on to the next millisecond once the 12 bits are used up", () => {
    const full = newRecordId(0x01_23_45_67_89_ab, ones);
    expect(full).toBe("01234567-89ab-7fff-bfff-ffffffffffff");
    expect(newRecordId(0x01_23_45_67_89_ab, zeros, full)).toBe(
      "01234567-89ac-7000-8000-000000000000",
    );
    expect(newRecordId(0x01_23_45_67_89_ab, ones, full)).toBe(
      "01234567-89ac-7fff-bfff-ffffffffffff",
    );
  });

  it("refuses to move past the largest time, and to follow something that is not a record id", () => {
    const last = newRecordId(2 ** 48 - 1, ones);
    expect(() => newRecordId(2 ** 48 - 1, zeros, last)).toThrow(DataLayerError);
    expect(() => newRecordId(1, zeros, "1")).toThrow(DataLayerError);
  });
});

describe("recordIdIssuer", () => {
  it("issues ever greater ids, whatever the clock does", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 50 }),
        // With every random bit set, each id uses the counter up, and the next moves on.
        fc.constantFrom(randomBytes, ones),
        (times, random) => {
          const next = recordIdIssuer(random);
          let last = "";
          for (const now of times) {
            const id = next(now);
            expect(isRecordId(id)).toBe(true);
            expect(id > last).toBe(true);
            last = id;
          }
        },
      ),
    );
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
