import { DataLayerError } from "./errors.ts";
import { type Hlc, isFromFuture, isHlc, maxHlc } from "./hlc.ts";
import { SETTINGS_ID, isRecordId } from "./ids.ts";
import { type JsonObject, type JsonValue, canonicalJson, toJsonValue, utf8Length } from "./json.ts";
import { SETTINGS_STORE, isFieldName } from "./names.ts";

/**
 * One stored item (data model §2.1): its permanent id, the schema version it conforms to, its
 * fields, the HLC that last wrote each field, and the HLC of its latest deletion, if any.
 * `clock` has exactly the keys of `data`, and every clock is greater than `deleted`.
 */
export interface DataRecord {
  readonly id: string;
  readonly v: number;
  readonly data: JsonObject;
  readonly clock: Readonly<Record<string, Hlc>>;
  readonly deleted?: Hlc;
}

/** The most fields a store's schema can have (data model §2.4). */
export const MAX_FIELDS = 256;

/** The largest record, as canonical JSON in UTF-8 (data model §2.4). */
export const MAX_RECORD_BYTES = 1024 * 1024;

const MEMBERS = new Set(["id", "v", "data", "clock", "deleted"]);

/** Whether a record is deleted: it has a tombstone and no fields written since (§2.2). */
export function isDeleted(record: DataRecord): boolean {
  return record.deleted !== undefined && Object.keys(record.clock).length === 0;
}

/** The greatest of a record's clocks and its tombstone; `undefined` if it has neither. */
export function lastChange(record: DataRecord): Hlc | undefined {
  let last = record.deleted;
  for (const hlc of Object.values(record.clock)) {
    last = maxHlc(last, hlc);
  }
  return last;
}

/** Throws unless the record is within the limits of data model §2.4. */
export function assertWithinLimits(record: DataRecord): void {
  if (Object.keys(record.data).length > MAX_FIELDS) {
    throw new DataLayerError(
      "too-large",
      `Record ${record.id} has more than ${MAX_FIELDS} fields.`,
    );
  }
  if (utf8Length(canonicalJson(toJson(record))) > MAX_RECORD_BYTES) {
    throw new DataLayerError("too-large", `Record ${record.id} is larger than 1 MiB.`);
  }
}

/** A record as the JSON object that backups contain (data model §2.1). */
export function toJson(record: DataRecord): JsonObject {
  const json: Record<string, JsonValue> = {
    id: record.id,
    v: record.v,
    data: record.data,
    clock: record.clock,
  };
  if (record.deleted !== undefined) {
    json["deleted"] = record.deleted;
  }
  return json;
}

/** Where a record from outside comes from, and what this device knows. */
export interface RecordContext {
  /** The store it belongs to. */
  readonly store: string;
  /** The app's current schema version: the highest a record may have. */
  readonly version: number;
  /** This device's time, `Date.now()`, to refuse clocks from the future. */
  readonly now: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): DataLayerError {
  return new DataLayerError("invalid", message);
}

function checkClock(value: unknown, now: number, what: string): Hlc {
  if (!isHlc(value)) {
    throw invalid(`${what} is not a well-formed HLC.`);
  }
  if (isFromFuture(value, now)) {
    throw new DataLayerError("future-clock", `${what} lies more than 24 hours in the future.`);
  }
  return value;
}

/**
 * Checks the structure of a record from outside, such as a backup (data model §8, step 1), and
 * returns a normalized copy. Throws a `DataLayerError`: `future-clock` for an HLC more than 24
 * hours ahead of `now`, `too-large` beyond a limit, `invalid` for anything else. The schema of
 * its store is checked separately (step 2).
 */
export function checkRecord(value: unknown, context: RecordContext): DataRecord {
  if (!isObject(value)) {
    throw invalid("A record must be a JSON object.");
  }
  if (Object.keys(value).some((member) => !MEMBERS.has(member))) {
    throw invalid("A record has a member other than id, v, data, clock and deleted.");
  }
  const { id, v, data, clock, deleted } = value;
  if (!isRecordId(id)) {
    throw invalid("A record's id is not a lowercase UUIDv7.");
  }
  if (context.store === SETTINGS_STORE && id !== SETTINGS_ID) {
    throw invalid(`The settings record must have the id ${SETTINGS_ID}.`);
  }
  if (context.store === SETTINGS_STORE && Object.hasOwn(value, "deleted")) {
    throw invalid("The settings record is never deleted.");
  }
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > context.version) {
    throw invalid(`Record ${id} has a schema version other than 1 to ${context.version}.`);
  }
  if (!isObject(data) || !isObject(clock)) {
    throw invalid(`Record ${id} must have the objects data and clock.`);
  }

  const fields = Object.keys(data);
  if (fields.length > MAX_FIELDS) {
    throw new DataLayerError("too-large", `Record ${id} has more than ${MAX_FIELDS} fields.`);
  }
  const clockFields = Object.keys(clock);
  if (
    clockFields.length !== fields.length ||
    clockFields.some((field) => !Object.hasOwn(data, field))
  ) {
    throw invalid(`Record ${id} must have a clock for each field and for nothing else.`);
  }

  const tombstone = Object.hasOwn(value, "deleted")
    ? checkClock(deleted, context.now, `The tombstone of record ${id}`)
    : undefined;
  const checkedData: Record<string, JsonValue> = {};
  const checkedClock: Record<string, Hlc> = {};
  for (const field of fields) {
    if (!isFieldName(field)) {
      throw invalid(`Record ${id} has a field whose name is not allowed.`);
    }
    const hlc = checkClock(clock[field], context.now, `The clock of ${id}.${field}`);
    if (tombstone !== undefined && hlc <= tombstone) {
      throw invalid(`The clock of ${id}.${field} is not after the record's deletion.`);
    }
    checkedData[field] = toJsonValue(data[field], `${id}.${field}`);
    checkedClock[field] = hlc;
  }

  const record: DataRecord =
    tombstone === undefined
      ? { id, v, data: checkedData, clock: checkedClock }
      : { id, v, data: checkedData, clock: checkedClock, deleted: tombstone };
  assertWithinLimits(record);
  return record;
}
