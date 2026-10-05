import { DataLayerError } from "./errors.ts";

/** A JSON value as records store it (data model §2.3). */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** How many levels of arrays and objects a value may have (data model §2.4). */
export const MAX_DEPTH = 32;

const encoder = new TextEncoder();

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Messages name the field but never anything inside its value: member names in a value are
// user data too.
function invalid(path: string, problem: string): DataLayerError {
  return new DataLayerError("invalid", `${path} ${problem}.`);
}

function copy(value: unknown, path: string, depth: number): JsonValue {
  switch (typeof value) {
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw invalid(path, "is or contains a number that is not finite");
      }
      // `-0` is stored as `0`.
      return value === 0 ? 0 : value;
    case "string":
      if (!value.isWellFormed()) {
        throw invalid(path, "is or contains a string that is not well-formed Unicode");
      }
      return value;
    case "object": {
      if (value === null) {
        return null;
      }
      if (depth === MAX_DEPTH) {
        throw invalid(path, `has more than ${MAX_DEPTH} levels of arrays and objects`);
      }
      if (Array.isArray(value)) {
        const items: readonly unknown[] = value;
        const result: JsonValue[] = [];
        for (let index = 0; index < items.length; index++) {
          if (!Object.hasOwn(items, index)) {
            throw invalid(path, "contains an array with a missing item");
          }
          result.push(copy(items[index], path, depth + 1));
        }
        return result;
      }
      if (!isPlainObject(value)) {
        throw invalid(path, "is or contains an object that is not a plain object");
      }
      const result: Record<string, JsonValue> = {};
      for (const key of Object.keys(value)) {
        if (key === "__proto__") {
          throw invalid(path, 'contains a member named "__proto__"');
        }
        if (!key.isWellFormed()) {
          throw invalid(path, "contains a member name that is not well-formed Unicode");
        }
        const item: unknown = Reflect.get(value, key);
        result[key] = copy(item, path, depth + 1);
      }
      return result;
    }
    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      break;
  }
  throw invalid(path, "is or contains something other than a JSON value");
}

/**
 * A copy of `value` as a stored JSON value (data model §2.3): `null`, a boolean, a finite number,
 * a well-formed string, or arrays and plain objects of these, at most 32 levels deep, with no
 * member named `__proto__`. `-0` becomes `0`. Throws a `DataLayerError` for anything else, naming
 * `path` but nothing inside the value.
 */
export function toJsonValue(value: unknown, path = "The value"): JsonValue {
  return copy(value, path, 0);
}

function isArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/**
 * The JSON Canonicalization Scheme (RFC 8785) of a stored value: members sorted by their names'
 * UTF-16 code units, no whitespace, and numbers and strings as ECMAScript writes them (data
 * model §5.4).
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object: JsonObject = value;
  const members = Object.keys(object)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key] ?? null)}`);
  return `{${members.join(",")}}`;
}

/** The size of a string in UTF-8, in bytes. */
export function utf8Length(text: string): number {
  return encoder.encode(text).byteLength;
}
