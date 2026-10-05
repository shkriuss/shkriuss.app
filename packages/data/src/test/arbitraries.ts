import * as fc from "fast-check";
import { type Hlc, formatHlc } from "../hlc.ts";
import type { JsonValue } from "../json.ts";
import type { DataRecord } from "../record.ts";

/**
 * Generators for property-based tests. Clocks and field names come from small sets, so that
 * generated copies of a record often share fields and clocks, and sometimes have equal clocks
 * with different values, as damaged or crafted data can.
 */

export const RECORD_ID = "01a10307-b840-78aa-ab29-1a1138faaff6";

const DEVICES = ["0000000000000001", "9f86d081884c7d65", "ffffffffffffffff"];

export const hlc: fc.Arbitrary<Hlc> = fc
  .record({
    wall: fc.integer({ min: 1_791_052_200_000, max: 1_791_052_200_003 }),
    counter: fc.integer({ min: 0, max: 2 }),
    device: fc.constantFrom(...DEVICES),
  })
  .map((parts) => formatHlc(parts));

export const fieldName = fc.constantFrom("title", "done", "tags", "note");

const memberName = fc
  .string({ unit: "grapheme", maxLength: 6 })
  .filter((key) => key !== "__proto__");

/** Any value a field can hold, with `-0` as `0` as the data layer stores it. */
export const jsonValue: fc.Arbitrary<JsonValue> = fc.letrec<{ value: JsonValue }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small", maxDepth: 4, withCrossShrink: true },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .map((number) => (number === 0 ? 0 : number)),
    fc.string({ unit: "grapheme", maxLength: 8 }),
    fc.array(tie("value"), { maxLength: 3 }),
    fc.dictionary(memberName, tie("value"), { maxKeys: 3, noNullPrototype: true }),
  ),
})).value;

/** A valid copy of the record `RECORD_ID`: every clock is greater than its tombstone. */
export const dataRecord: fc.Arbitrary<DataRecord> = fc
  .record({
    fields: fc.dictionary(fieldName, fc.record({ value: jsonValue, clock: hlc }), {
      maxKeys: 4,
      noNullPrototype: true,
    }),
    deleted: fc.option(hlc, { nil: undefined }),
  })
  .map(({ fields, deleted }) => {
    const data: Record<string, JsonValue> = {};
    const clock: Record<string, Hlc> = {};
    for (const [field, write] of Object.entries(fields)) {
      if (deleted === undefined || write.clock > deleted) {
        data[field] = write.value;
        clock[field] = write.clock;
      }
    }
    return deleted === undefined
      ? { id: RECORD_ID, v: 1, data, clock }
      : { id: RECORD_ID, v: 1, data, clock, deleted };
  });
