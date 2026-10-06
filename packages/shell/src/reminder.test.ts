import type { DeviceState } from "@shkriuss/data";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LATER, REMIND_AFTER, reminderFor } from "./reminder.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 6, 12, 0);

function device(lastBackup: number | null, changesSinceBackup: number): DeviceState {
  return { device: "0123456789abcdef", lastBackup, changesSinceBackup };
}

/** Times within a few years of 2026, in milliseconds since 1970. */
const time = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2035, 0, 1) });

describe("reminderFor", () => {
  it("says nothing while every change is in a backup", () => {
    fc.assert(
      fc.property(fc.option(time, { nil: null }), time, (lastBackup, now) => {
        expect(reminderFor(device(lastBackup, 0), now)).toBeUndefined();
      }),
    );
  });

  it("asks for a first backup as soon as the device has data", () => {
    expect(reminderFor(device(null, 1), NOW)).toStrictEqual({ kind: "first" });
    expect(reminderFor(device(null, 250), NOW)).toStrictEqual({ kind: "first" });
  });

  it("comes back once the last backup is a week old, with what changed since", () => {
    expect(reminderFor(device(NOW - REMIND_AFTER + 1, 3), NOW)).toBeUndefined();
    expect(reminderFor(device(NOW - REMIND_AFTER, 3), NOW)).toStrictEqual({
      kind: "due",
      lastBackup: NOW - REMIND_AFTER,
      changes: 3,
    });
    expect(reminderFor(device(NOW - 400 * DAY, 1), NOW)).toStrictEqual({
      kind: "due",
      lastBackup: NOW - 400 * DAY,
      changes: 1,
    });
  });

  it("does not let a clock that was ahead silence it", () => {
    // A clock a little ahead, as before the device set its time again, is not a reason.
    expect(reminderFor(device(NOW + DAY, 3), NOW)).toBeUndefined();
    expect(reminderFor(device(NOW + DAY + 1, 3), NOW)).toStrictEqual({
      kind: "due",
      lastBackup: NOW + DAY + 1,
      changes: 3,
    });
  });

  it("is due exactly when the last backup is a week old or more, or more than a day ahead", () => {
    const YEARS = 10 * 365 * DAY;
    const changes = fc.integer({ min: 1, max: 1_000_000 });
    /** Whether a last backup of `age`, the time since it, makes the reminder due. */
    function dueAt(age: fc.Arbitrary<number>, due: boolean): void {
      fc.assert(
        fc.property(time, age, changes, (now, ageOf, count) => {
          const lastBackup = now - ageOf;
          expect(reminderFor(device(lastBackup, count), now)).toStrictEqual(
            due ? { kind: "due", lastBackup, changes: count } : undefined,
          );
        }),
      );
    }
    dueAt(fc.integer({ min: REMIND_AFTER, max: YEARS }), true);
    dueAt(fc.integer({ min: -DAY, max: REMIND_AFTER - 1 }), false);
    dueAt(fc.integer({ min: -YEARS, max: -DAY - 1 }), true);
  });

  it("is hidden by Later for a day, a week being when it comes back", () => {
    expect(LATER).toBe(DAY);
    expect(REMIND_AFTER).toBe(7 * DAY);
  });
});
