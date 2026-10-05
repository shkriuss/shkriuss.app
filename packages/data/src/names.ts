/** The store for an app's settings, which travel with its backups (data model §2.5). */
export const SETTINGS_STORE = "settings";

/** The store for the data layer's own state, which holds no records (data model §2.5, §7). */
export const META_STORE = "meta";

const NAME = /^[a-z][A-Za-z0-9]{0,63}$/;

/** Names that `Object.prototype` already uses, which records and stores must not (§2.3). */
const OBJECT_MEMBERS = new Set([
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
]);

/** Whether `name` can name a field (data model §2.3). */
export function isFieldName(name: string): boolean {
  return NAME.test(name) && !OBJECT_MEMBERS.has(name);
}

/** Whether `name` can name a store of records (data model §2.5); `meta` is the data layer's. */
export function isStoreName(name: string): boolean {
  return isFieldName(name) && name !== META_STORE;
}
