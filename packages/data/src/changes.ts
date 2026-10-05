import { DataError } from "./errors.ts";
import { type Hlc, isHlc } from "./hlc.ts";
import { isRecordId } from "./ids.ts";
import { type JsonValue, toJsonValue } from "./json.ts";
import { isFieldName } from "./names.ts";
import { type DataRecord, assertWithinLimits, isDeleted, lastChange } from "./record.ts";

/**
 * The writes of a change (data model §4). Each takes the change's HLC, which the device issued
 * for it and which is therefore later than every HLC the record holds. They return a new record
 * and never change the one they are given.
 */

/** Field values to write, by field name. */
export type FieldValues = Readonly<Record<string, unknown>>;

function checkHlc(hlc: Hlc): void {
  if (!isHlc(hlc)) {
    throw new DataError("invalid", "A change needs a well-formed HLC.");
  }
}

function writeFields(
  data: Record<string, JsonValue>,
  clock: Record<string, Hlc>,
  fields: FieldValues,
  hlc: Hlc,
): void {
  for (const [field, value] of Object.entries(fields)) {
    if (!isFieldName(field)) {
      throw new DataError("invalid", `"${field}" is not an allowed field name.`);
    }
    data[field] = toJsonValue(value, `The field ${field}`);
    clock[field] = hlc;
  }
}

/**
 * A new record (data model §4.1): each field given is stored with the clock `hlc`; fields not
 * given are missing and read as their defaults.
 */
export function createRecord(id: string, v: number, fields: FieldValues, hlc: Hlc): DataRecord {
  if (!isRecordId(id)) {
    throw new DataError("invalid", "A record's id must be a lowercase UUIDv7.");
  }
  if (!Number.isSafeInteger(v) || v < 1) {
    throw new DataError("invalid", "A schema version is an integer from 1.");
  }
  checkHlc(hlc);
  const data: Record<string, JsonValue> = {};
  const clock: Record<string, Hlc> = {};
  writeFields(data, clock, fields, hlc);
  const record: DataRecord = { id, v, data, clock };
  assertWithinLimits(record);
  return record;
}

function assertLater(record: DataRecord, hlc: Hlc): void {
  const last = lastChange(record);
  if (last !== undefined && hlc <= last) {
    throw new DataError("invalid", `A change to record ${record.id} must be later than its last.`);
  }
}

/**
 * The record after a change writes `fields` (data model §4.2): each gets its new value and the
 * clock `hlc`, even if the value is the default; other fields keep theirs. Returns the same
 * record if there is nothing to write. A deleted record cannot be updated.
 */
export function updateRecord(record: DataRecord, fields: FieldValues, hlc: Hlc): DataRecord {
  checkHlc(hlc);
  if (isDeleted(record)) {
    throw new DataError("deleted", `Record ${record.id} is deleted and cannot be updated.`);
  }
  if (Object.keys(fields).length === 0) {
    return record;
  }
  assertLater(record, hlc);
  const data: Record<string, JsonValue> = { ...record.data };
  const clock: Record<string, Hlc> = { ...record.clock };
  writeFields(data, clock, fields, hlc);
  const updated: DataRecord = { ...record, data, clock };
  assertWithinLimits(updated);
  return updated;
}

/**
 * The record after a change deletes it (data model §4.3): a tombstone with the clock `hlc` and
 * no fields. The content is gone at once; only the id, the schema version and the time of the
 * deletion remain. Returns the same record if it is already deleted.
 */
export function deleteRecord(record: DataRecord, hlc: Hlc): DataRecord {
  checkHlc(hlc);
  if (isDeleted(record)) {
    return record;
  }
  assertLater(record, hlc);
  return { id: record.id, v: record.v, data: {}, clock: {}, deleted: hlc };
}
