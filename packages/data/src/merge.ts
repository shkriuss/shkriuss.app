import { DataError } from "./errors.ts";
import { type Hlc, maxHlc } from "./hlc.ts";
import { type JsonValue, canonicalJson } from "./json.ts";
import type { DataRecord } from "./record.ts";

interface FieldWrite {
  readonly value: JsonValue;
  readonly clock: Hlc;
}

function fieldOf(record: DataRecord, field: string): FieldWrite | undefined {
  const clock = Object.hasOwn(record.clock, field) ? record.clock[field] : undefined;
  if (clock === undefined) {
    return undefined;
  }
  return { value: record.data[field] ?? null, clock };
}

/**
 * The later of two writes of a field: the greater clock, where a missing write is lower than
 * every HLC. Equal clocks with different values occur only in damaged or crafted data; then the
 * value with the greater canonical JSON wins, so the result does not depend on the order.
 */
function later(a: FieldWrite | undefined, b: FieldWrite | undefined): FieldWrite | undefined {
  if (a === undefined || b === undefined) {
    return a ?? b;
  }
  if (a.clock !== b.clock) {
    return a.clock > b.clock ? a : b;
  }
  return canonicalJson(a.value) >= canonicalJson(b.value) ? a : b;
}

/**
 * Merges two copies of the same record (data model §5): the later tombstone, the later write of
 * each field, and none of the fields that the tombstone erased. Merging is commutative,
 * associative and idempotent, so the order and number of imports do not matter.
 *
 * Both copies must be valid records with the same id and schema version; migrate an older copy
 * first (data model §6).
 */
export function mergeRecords(a: DataRecord, b: DataRecord): DataRecord {
  if (a.id !== b.id || a.v !== b.v) {
    throw new DataError(
      "invalid",
      "Only copies of the same record at the same schema version can be merged.",
    );
  }
  const deleted = maxHlc(a.deleted, b.deleted);
  const data: Record<string, JsonValue> = {};
  const clock: Record<string, Hlc> = {};
  for (const field of new Set([...Object.keys(a.clock), ...Object.keys(b.clock)])) {
    const write = later(fieldOf(a, field), fieldOf(b, field));
    // A write that is not after the latest deletion was erased by it.
    if (write === undefined || (deleted !== undefined && write.clock <= deleted)) {
      continue;
    }
    data[field] = write.value;
    clock[field] = write.clock;
  }
  return deleted === undefined
    ? { id: a.id, v: a.v, data, clock }
    : { id: a.id, v: a.v, data, clock, deleted };
}
