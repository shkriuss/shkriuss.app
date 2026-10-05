import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataLayerError } from "./errors.ts";
import {
  INITIAL_CLOCK,
  MAX_CLOCK_AHEAD,
  MAX_COUNTER,
  MAX_WALL,
  formatHlc,
  isDeviceId,
  isFromFuture,
  isHlc,
  issueHlc,
  maxHlc,
  newDeviceId,
  parseHlc,
  receiveHlc,
} from "./hlc.ts";

const DEVICE = "9f86d081884c7d65";
const EXAMPLE = "001791052200000:00000:9f86d081884c7d65";

describe("HLC format (data model §3.1)", () => {
  it("writes the three parts at fixed widths", () => {
    expect(formatHlc({ wall: 1_791_052_200_000, counter: 0, device: DEVICE })).toBe(EXAMPLE);
    expect(formatHlc({ wall: 0, counter: MAX_COUNTER, device: DEVICE })).toBe(
      "000000000000000:65535:9f86d081884c7d65",
    );
    expect(formatHlc({ wall: MAX_WALL, counter: 7, device: DEVICE })).toBe(
      "999999999999999:00007:9f86d081884c7d65",
    );
  });

  it("reads them back", () => {
    expect(parseHlc(EXAMPLE)).toStrictEqual({
      wall: 1_791_052_200_000,
      counter: 0,
      device: DEVICE,
    });
    expect(isHlc(EXAMPLE)).toBe(true);
  });

  it.each([-1, MAX_WALL + 1, 1.5, Number.NaN])("refuses the wall time %d", (wall) => {
    expect(() => formatHlc({ wall, counter: 0, device: DEVICE })).toThrow(DataLayerError);
  });

  it.each([-1, MAX_COUNTER + 1, 0.5])("refuses the counter %d", (counter) => {
    expect(() => formatHlc({ wall: 0, counter, device: DEVICE })).toThrow(DataLayerError);
  });

  it.each(["", "9F86D081884C7D65", "9f86d081884c7d6", "9f86d081884c7d65a", "9f86d081884c7d6g"])(
    "refuses the device id %j",
    (device) => {
      expect(() => formatHlc({ wall: 0, counter: 0, device })).toThrow(DataLayerError);
      expect(isDeviceId(device)).toBe(false);
    },
  );

  it.each([
    "001791052200000:65536:9f86d081884c7d65",
    "001791052200000:99999:9f86d081884c7d65",
    "1791052200000:00000:9f86d081884c7d65",
    "001791052200000:0:9f86d081884c7d65",
    "001791052200000:00000:9F86D081884C7D65",
    "001791052200000-00000-9f86d081884c7d65",
    ` ${EXAMPLE}`,
    `${EXAMPLE}\n`,
    "",
    1_791_052_200_000,
    null,
  ])("does not read %j as an HLC", (value) => {
    expect(parseHlc(value)).toBeUndefined();
    expect(isHlc(value)).toBe(false);
  });

  it("orders HLCs as strings by wall time, then counter, then device", () => {
    const parts = fc.record({
      wall: fc.integer({ min: 0, max: MAX_WALL }),
      counter: fc.integer({ min: 0, max: MAX_COUNTER }),
      device: fc.constantFrom("0000000000000000", DEVICE, "ffffffffffffffff"),
    });
    fc.assert(
      fc.property(parts, parts, (a, b) => {
        const byDevice = a.device < b.device ? -1 : a.device > b.device ? 1 : 0;
        const byParts = a.wall - b.wall || a.counter - b.counter || byDevice;
        const byString = formatHlc(a) < formatHlc(b) ? -1 : formatHlc(a) > formatHlc(b) ? 1 : 0;
        expect(byString).toBe(Math.sign(byParts));
      }),
    );
  });
});

describe("device ids (data model §3.2)", () => {
  it("are 64 random bits as hexadecimal digits", () => {
    const bytes = Uint8Array.from([0x00, 0x01, 0x0a, 0x9f, 0xab, 0xcd, 0xef, 0xff]);
    expect(newDeviceId(() => bytes)).toBe("00010a9fabcdefff");
    expect(isDeviceId(newDeviceId())).toBe(true);
    expect(newDeviceId()).not.toBe(newDeviceId());
  });
});

describe("issueHlc (data model §3.3)", () => {
  it("uses the current time when it is later than the last HLC", () => {
    expect(issueHlc(INITIAL_CLOCK, 1_791_052_200_000, DEVICE)).toStrictEqual({
      hlc: EXAMPLE,
      clock: { wall: 1_791_052_200_000, counter: 0 },
    });
  });

  it("counts changes within the same millisecond", () => {
    const first = issueHlc(INITIAL_CLOCK, 1_000, DEVICE);
    const second = issueHlc(first.clock, 1_000, DEVICE);
    expect(second.clock).toStrictEqual({ wall: 1_000, counter: 1 });
    expect(second.hlc > first.hlc).toBe(true);
  });

  it("stays after the last HLC when the device's clock goes back", () => {
    const issued = issueHlc({ wall: 5_000, counter: 3 }, 1_000, DEVICE);
    expect(issued.clock).toStrictEqual({ wall: 5_000, counter: 4 });
  });

  it("moves to the next millisecond when the counter is full", () => {
    const issued = issueHlc({ wall: 5_000, counter: MAX_COUNTER }, 5_000, DEVICE);
    expect(issued.clock).toStrictEqual({ wall: 5_001, counter: 0 });
  });

  it("issues ever greater HLCs, whatever the device's clock does", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 10 }), { maxLength: 50 }), (times) => {
        let clock = INITIAL_CLOCK;
        let last = "";
        for (const now of times) {
          const issued = issueHlc(clock, now, DEVICE);
          expect(issued.hlc > last).toBe(true);
          last = issued.hlc;
          clock = issued.clock;
        }
      }),
    );
  });
});

describe("receiveHlc (data model §3.4)", () => {
  const last = { wall: 5_000, counter: 2 };

  it("moves the clock to a later HLC from elsewhere", () => {
    expect(receiveHlc(last, formatHlc({ wall: 6_000, counter: 0, device: DEVICE }))).toStrictEqual({
      wall: 6_000,
      counter: 0,
    });
    expect(receiveHlc(last, formatHlc({ wall: 5_000, counter: 3, device: DEVICE }))).toStrictEqual({
      wall: 5_000,
      counter: 3,
    });
  });

  it("keeps the clock for an earlier or equal HLC", () => {
    for (const parts of [
      { wall: 4_000, counter: 9 },
      { wall: 5_000, counter: 1 },
      { wall: 5_000, counter: 2 },
    ]) {
      expect(receiveHlc(last, formatHlc({ ...parts, device: DEVICE }))).toBe(last);
    }
  });

  it("makes the next HLC sort after everything received", () => {
    const received = formatHlc({ wall: 9_000, counter: 4, device: "ffffffffffffffff" });
    const next = issueHlc(receiveHlc(last, received), 1_000, "0000000000000000");
    expect(next.hlc > received).toBe(true);
  });

  it("refuses something that is not an HLC", () => {
    expect(() => receiveHlc(last, "not an HLC")).toThrow(DataLayerError);
  });
});

describe("isFromFuture (data model §3.5)", () => {
  const now = 1_791_052_200_000;

  it("allows up to 24 hours ahead of this device's clock", () => {
    const limit = formatHlc({ wall: now + MAX_CLOCK_AHEAD, counter: 0, device: DEVICE });
    expect(isFromFuture(limit, now)).toBe(false);
    expect(isFromFuture(EXAMPLE, now)).toBe(false);
  });

  it("refuses anything later", () => {
    const later = formatHlc({ wall: now + MAX_CLOCK_AHEAD + 1, counter: 0, device: DEVICE });
    expect(isFromFuture(later, now)).toBe(true);
  });

  it("refuses something that is not an HLC", () => {
    expect(() => isFromFuture("soon", now)).toThrow(DataLayerError);
  });
});

describe("maxHlc", () => {
  it("treats a missing HLC as lower than every HLC", () => {
    expect(maxHlc(undefined, undefined)).toBeUndefined();
    expect(maxHlc(EXAMPLE, undefined)).toBe(EXAMPLE);
    expect(maxHlc(undefined, EXAMPLE)).toBe(EXAMPLE);
    const later = formatHlc({ wall: 1_791_052_200_000, counter: 1, device: DEVICE });
    expect(maxHlc(EXAMPLE, later)).toBe(later);
    expect(maxHlc(later, EXAMPLE)).toBe(later);
  });
});
