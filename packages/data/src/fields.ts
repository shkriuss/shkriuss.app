import { isRecordId } from "./ids.ts";
import { type JsonValue, toJsonValue } from "./json.ts";
import { isFieldName, isStoreName } from "./names.ts";

/**
 * The type of a field (data model §2.3): which values it holds, and the default that a missing
 * field reads as. Build them with `field`:
 *
 * ```ts
 * const fields = {
 *   title: field.string({ maxLength: 200 }),
 *   done: field.boolean(),
 *   priority: field.enum(["low", "normal", "high"]).default("normal"),
 *   due: field.date().nullable(),
 * };
 * ```
 */
export interface FieldType<T = JsonValue> {
  /** What the field holds, for messages, such as "a string of at most 200 characters". */
  readonly description: string;
  /**
   * Which values the field holds, exactly, in one canonical form: two types with the same
   * signature hold the same values, whatever their defaults (data model §6).
   */
  readonly signature: string;
  /** The value a missing field reads as; `undefined` if the type has none yet. */
  readonly defaultValue: T | undefined;
  /** For a record id: the store of the records it refers to. */
  readonly references?: string;
  /** Whether a value is valid for this type. */
  isValid(value: unknown): boolean;
  /** This type, or `null`, which is then the default. */
  nullable(): FieldType<T | null>;
  /** This type with the given default, which must be valid. */
  default(value: T): FieldType<T>;
}

/** The values a field type holds. */
export type TypeOf<F> = F extends FieldType<infer T> ? T : never;

/** A frozen copy of a default, so that no reader can change it for every other. */
function frozen(value: JsonValue): JsonValue {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      frozen(item);
    }
    Object.freeze(value);
  }
  return value;
}

/** Narrows a value that `isValid` accepts to the type it checks for. */
function matches<T>(
  isValid: (value: unknown) => boolean,
  value: JsonValue,
): value is T & JsonValue {
  return isValid(value);
}

function fieldType<T>(
  description: string,
  signature: string,
  isValid: (value: unknown) => boolean,
  defaultValue?: unknown,
  references?: string,
): FieldType<T> {
  let checkedDefault: T | undefined;
  if (defaultValue !== undefined) {
    const copy = toJsonValue(defaultValue, "The default");
    if (!matches<T>(isValid, copy)) {
      throw new Error(`The default is not ${description}.`);
    }
    frozen(copy);
    checkedDefault = copy;
  }
  return {
    description,
    signature,
    defaultValue: checkedDefault,
    ...(references === undefined ? {} : { references }),
    isValid,
    nullable: () =>
      fieldType<T | null>(
        `${description}, or null`,
        `${signature}|null`,
        (value) => value === null || isValid(value),
        null,
        references,
      ),
    default: (value) => fieldType(description, signature, isValid, value, references),
  };
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function range(min: number, max: number, unit: string): string {
  const hasMin = min > 0;
  const hasMax = Number.isFinite(max);
  if (hasMin && hasMax) {
    return min === max ? `exactly ${min} ${unit}` : `${min} to ${max} ${unit}`;
  }
  if (hasMax) {
    return `at most ${max} ${unit}`;
  }
  return hasMin ? `at least ${min} ${unit}` : `any number of ${unit}`;
}

function assertBounds(min: number, max: number, what: string): void {
  if (!(min <= max) || min < 0 || Number.isNaN(min) || Number.isNaN(max)) {
    throw new Error(`The bounds of ${what} must be numbers with 0 <= min <= max.`);
  }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` is a calendar date `YYYY-MM-DD` from the year 1 to 9999. */
function isDate(value: unknown): boolean {
  const match = typeof value === "string" ? DATE.exec(value) : null;
  if (match === null) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= days;
}

export interface StringOptions {
  /** The fewest UTF-16 code units, as an HTML `minlength` counts them; 0 by default. */
  readonly minLength?: number;
  /** The most UTF-16 code units, as an HTML `maxlength` counts them; unlimited by default. */
  readonly maxLength?: number;
}

export interface NumberOptions {
  readonly min?: number;
  readonly max?: number;
  /** Only whole numbers within ±(2^53 - 1). */
  readonly integer?: boolean;
}

export interface ArrayOptions {
  readonly minItems?: number;
  readonly maxItems?: number;
}

/** Builders for field types. */
export const field = {
  /** A string; `""` by default if that is allowed. */
  string({ minLength = 0, maxLength = Infinity }: StringOptions = {}): FieldType<string> {
    assertBounds(minLength, maxLength, "a string's length");
    return fieldType<string>(
      `a string of ${range(minLength, maxLength, "characters")}`,
      `string(${minLength},${maxLength})`,
      (value) =>
        typeof value === "string" && value.length >= minLength && value.length <= maxLength,
      minLength === 0 ? "" : undefined,
    );
  },

  /** A finite number; `0` by default if that is allowed. */
  number({
    min = -Infinity,
    max = Infinity,
    integer = false,
  }: NumberOptions = {}): FieldType<number> {
    if (!(min <= max)) {
      throw new Error("A number's min must not be greater than its max.");
    }
    const kind = integer ? "a whole number" : "a number";
    const bounds = Number.isFinite(min) || Number.isFinite(max) ? ` from ${min} to ${max}` : "";
    const isValid = (value: unknown): boolean =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max &&
      (!integer || Number.isSafeInteger(value));
    return fieldType<number>(
      `${kind}${bounds}`,
      `number(${min},${max},${integer})`,
      isValid,
      isValid(0) ? 0 : undefined,
    );
  },

  /** `true` or `false`; `false` by default. */
  boolean(): FieldType<boolean> {
    return fieldType<boolean>(
      "true or false",
      "boolean",
      (value) => typeof value === "boolean",
      false,
    );
  },

  /** One of the given strings; the first by default. */
  enum<const V extends readonly [string, ...string[]]>(values: V): FieldType<V[number]> {
    if (new Set(values).size !== values.length) {
      throw new Error("The values of an enum must be different.");
    }
    const allowed = new Set<unknown>(values);
    return fieldType<V[number]>(
      `one of ${values.map((value) => JSON.stringify(value)).join(", ")}`,
      // The order of the values changes nothing that the field holds.
      `enum(${JSON.stringify(values.toSorted())})`,
      (value) => allowed.has(value),
      values[0],
    );
  },

  /**
   * The id of a record in `store`, or `null`, the default. Merging can leave a reference to a
   * deleted record, so readers must handle a missing target (data model §2.3).
   */
  reference(store: string): FieldType<string | null> {
    if (!isStoreName(store)) {
      throw new Error(`"${store}" is not a store name.`);
    }
    return fieldType<string | null>(
      `the id of a record of ${store}, or null`,
      // Any record id: the store it refers to changes nothing that the field holds.
      "id|null",
      (value) => value === null || isRecordId(value),
      null,
      store,
    );
  },

  /** A calendar date, `YYYY-MM-DD`; it has no default, so give one or make it nullable. */
  date(): FieldType<string> {
    return fieldType<string>("a date (YYYY-MM-DD)", "date", isDate);
  },

  /** A time in milliseconds since 1970 (UTC); it has no default. */
  timestamp(): FieldType<number> {
    return fieldType<number>("a time in milliseconds since 1970", "timestamp", (value) =>
      Number.isSafeInteger(value),
    );
  },

  /** A list of values of one type; `[]` by default if that is allowed. */
  array<T>(
    item: FieldType<T>,
    { minItems = 0, maxItems = Infinity }: ArrayOptions = {},
  ): FieldType<readonly T[]> {
    assertBounds(minItems, maxItems, "a list's length");
    return fieldType<readonly T[]>(
      `a list of ${range(minItems, maxItems, "items")}, each ${item.description}`,
      `array(${minItems},${maxItems},${item.signature})`,
      (value) =>
        Array.isArray(value) &&
        value.length >= minItems &&
        value.length <= maxItems &&
        value.every((entry: unknown) => item.isValid(entry)),
      minItems === 0 ? [] : undefined,
    );
  },

  /**
   * An object with exactly the given members, which merges as one value (data model §2.3). Its
   * default is the object of its members' defaults, if they all have one.
   */
  object<const M extends Readonly<Record<string, FieldType<unknown>>>>(
    members: M,
  ): FieldType<{ readonly [K in keyof M]: TypeOf<M[K]> }> {
    const names = Object.keys(members);
    for (const name of names) {
      if (!isFieldName(name)) {
        throw new Error(`"${name}" is not allowed as the name of a member.`);
      }
    }
    const types = names.map((name) => [name, members[name]] as const);
    const defaults = types.map(([name, type]) => [name, type?.defaultValue] as const);
    const hasDefault = defaults.every(([, value]) => value !== undefined);
    // The order of the members changes nothing that the field holds.
    const signatures = types
      .map(([name, type]) => `${name}:${type?.signature ?? ""}`)
      .toSorted()
      .join(",");
    return fieldType<{ readonly [K in keyof M]: TypeOf<M[K]> }>(
      `an object with the members ${names.join(", ")}`,
      `object(${signatures})`,
      (value) =>
        isPlainObject(value) &&
        Object.keys(value).length === names.length &&
        types.every(
          ([name, type]) =>
            Object.hasOwn(value, name) && type !== undefined && type.isValid(value[name]),
        ),
      hasDefault ? Object.fromEntries(defaults) : undefined,
    );
  },
} as const;
