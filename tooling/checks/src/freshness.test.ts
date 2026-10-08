import { describe, expect, it } from "vitest";
import { newerPnpm, nodeEndsSoon, nodeMajor, parseVersion, pinnedPnpm } from "./freshness.ts";

const THREE_DAYS = 3 * 24 * 60;

/** The registry's dates of pnpm's releases, around those of October 2026. */
const PUBLISHED = {
  created: "2015-12-29T00:00:00.000Z",
  modified: "2026-10-08T00:00:00.000Z",
  "11.28.3": "2026-09-30T15:27:28.430Z",
  "11.28.4": "2026-10-03T20:46:31.040Z",
  "11.28.5": "2026-10-06T05:23:58.800Z",
  "11.29.0-rc.1": "2026-10-04T00:00:00.000Z",
  "12.10.1": "2026-09-01T00:00:00.000Z",
};

describe("pinnedPnpm", () => {
  it("reads the version that packageManager pins, with its hash", () => {
    expect(pinnedPnpm("pnpm@11.28.3+sha512.d497")).toBe("11.28.3");
    expect(pinnedPnpm("pnpm@11.28.3")).toBeUndefined();
    expect(pinnedPnpm("yarn@4.5.0+sha512.d497")).toBeUndefined();
  });
});

describe("newerPnpm", () => {
  it("finds the newest release of the same major that has been out long enough", () => {
    expect(newerPnpm("11.28.3", PUBLISHED, new Date("2026-10-08T00:00:00Z"), THREE_DAYS)).toBe(
      "11.28.4",
    );
    expect(newerPnpm("11.28.3", PUBLISHED, new Date("2026-10-09T06:00:00Z"), THREE_DAYS)).toBe(
      "11.28.5",
    );
  });

  it("finds nothing once the newest settled release is pinned, nor a prerelease or a new major", () => {
    expect(
      newerPnpm("11.28.4", PUBLISHED, new Date("2026-10-08T00:00:00Z"), THREE_DAYS),
    ).toBeUndefined();
    expect(
      newerPnpm("11.28.5", PUBLISHED, new Date("2026-12-01T00:00:00Z"), THREE_DAYS),
    ).toBeUndefined();
  });

  it("refuses a pinned version that it cannot read", () => {
    expect(() => newerPnpm("eleven", PUBLISHED, new Date(), THREE_DAYS)).toThrow(
      '"eleven" is not a version of pnpm.',
    );
  });
});

describe("nodeMajor", () => {
  it("reads the major version of .node-version", () => {
    expect(nodeMajor("24\n")).toBe(24);
    expect(nodeMajor("v24.10.0")).toBe(24);
    expect(nodeMajor("lts/*")).toBeUndefined();
  });
});

describe("nodeEndsSoon", () => {
  const SCHEDULE = { v24: { end: "2028-04-30" } };

  it("gives the end of life once it is less than the given days away, or past", () => {
    expect(nodeEndsSoon(24, SCHEDULE, new Date("2026-10-08"), 183)).toBeUndefined();
    expect(nodeEndsSoon(24, SCHEDULE, new Date("2027-11-01"), 183)).toBe("2028-04-30");
    expect(nodeEndsSoon(24, SCHEDULE, new Date("2028-06-01"), 183)).toBe("2028-04-30");
  });

  it("refuses a version that the schedule does not have", () => {
    expect(() => nodeEndsSoon(23, SCHEDULE, new Date(), 183)).toThrow(
      "The release schedule of Node.js has no version 23.",
    );
  });
});

describe("parseVersion", () => {
  it("reads major.minor.patch only", () => {
    expect(parseVersion("11.28.3")).toEqual([11, 28, 3]);
    expect(parseVersion("11.29.0-rc.1")).toBeUndefined();
  });
});
