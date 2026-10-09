import { isDeepStrictEqual } from "node:util";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataLayerError } from "./errors.ts";
import { checkIncomingStores, type Incoming } from "./incoming.ts";
import { VERSION_2 } from "./test/storage.ts";

// The stores of a backup are untrusted (data model §8). Whatever they hold, checking them either
// refuses them with the data layer's own error, or gives records that pass the check again
// unchanged: never another error, and never a record that the check would refuse. The tests of
// @shkriuss/backup change valid backups at random, which checks the records near valid ones.

/**
 * What checking `stores` of `version` comes to: "refused" for the data layer's own error, and
 * "stable" for records that pass the check again unchanged. Anything else is returned as it is,
 * such as another error, for the test to show.
 */
function outcome(version: unknown, stores: unknown): unknown {
  let checked: Incoming;
  try {
    // @ts-expect-error -- Hostile input: the version may be anything.
    checked = checkIncomingStores(VERSION_2, version, stores);
  } catch (error) {
    return error instanceof DataLayerError ? "refused" : error;
  }
  const again = checkIncomingStores(VERSION_2, checked.version, structuredClone(checked.stores));
  return isDeepStrictEqual(again.stores, checked.stores)
    ? "stable"
    : { checked: checked.stores, again: again.stores };
}

describe("checkIncomingStores, with hostile input (data model §8)", () => {
  it("refuses any value as the stores or the version with its own error, or checks it", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -1, max: 4 }), fc.jsonValue()),
        fc.jsonValue(),
        (version, stores) => {
          expect(["refused", "stable"]).toContain(outcome(version, stores));
        },
      ),
      // With a version that the app has, stores of other types, which random values seldom are.
      {
        examples: [
          [1, null],
          [2, null],
          [2, 2],
          [2, "notes"],
          [2, []],
          [2, [[], [], []]],
        ],
      },
    );
  });

  it("refuses records of any shape in each store with its own error, or checks them", () => {
    // Each store an array of anything, or not an array at all.
    const store = fc.oneof(fc.array(fc.jsonValue(), { maxLength: 3 }), fc.jsonValue());
    fc.assert(
      fc.property(fc.record({ notes: store, folders: store, settings: store }), (stores) => {
        expect(["refused", "stable"]).toContain(outcome(2, stores));
      }),
    );
  });
});
