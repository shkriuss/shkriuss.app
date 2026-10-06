/**
 * What the screens show of the lists and their items (docs/specs/apps/checklists.md §1, §3).
 * Records come from the data layer sorted by id: in the order they were added.
 */

import type { AppReader } from "../../schema.ts";

export interface ListRecord {
  readonly id: string;
  readonly values: { readonly name: string };
}

export interface ItemRecord {
  readonly id: string;
  readonly values: { readonly list: string | null; readonly text: string; readonly done: boolean };
}

/** What a list's screen shows: the list, unless it is missing or deleted, and every item. */
export interface ListContent {
  readonly list: ListRecord | undefined;
  readonly items: readonly ItemRecord[];
}

/** Reads what a list's screen shows, as its route loads it and as the screen observes it. */
export async function readList(reader: AppReader, id: string): Promise<ListContent> {
  return { list: await reader.get("lists", id), items: await reader.list("items") };
}

/** The lists sorted by name, as people read names: "List 2" before "List 10". */
export function byName(lists: readonly ListRecord[]): ListRecord[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return lists.toSorted(
    (a, b) => collator.compare(a.values.name, b.values.name) || (a.id < b.id ? -1 : 1),
  );
}

/** The items of a list: those to do, then those done, each in the order they were added. */
export function itemsOf(
  list: string,
  items: readonly ItemRecord[],
): { readonly toDo: ItemRecord[]; readonly done: ItemRecord[] } {
  const own = items.filter((item) => item.values.list === list);
  return {
    toDo: own.filter((item) => !item.values.done),
    done: own.filter((item) => item.values.done),
  };
}

/** How many of a list's items are done, of how many. */
export function progressOf(
  list: string,
  items: readonly ItemRecord[],
): { readonly done: number; readonly total: number } {
  const { toDo, done } = itemsOf(list, items);
  return { done: done.length, total: toDo.length + done.length };
}

/**
 * The item that takes the place of `id` in `section` once it goes: the next one, or else the
 * one before; `undefined` if it was the only one, or is not there.
 */
export function neighbor(section: readonly ItemRecord[], id: string): string | undefined {
  const index = section.findIndex((item) => item.id === id);
  if (index === -1) {
    return undefined;
  }
  return (section[index + 1] ?? section[index - 1])?.id;
}
