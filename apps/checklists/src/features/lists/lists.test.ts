import { describe, expect, it } from "vitest";
import { type ItemRecord, byName, itemsOf, neighbor, progressOf } from "./lists.ts";

const list = (id: string, name: string) => ({ id, values: { name } });
const item = (id: string, done: boolean, on: string | null = "groceries"): ItemRecord => ({
  id,
  values: { list: on, text: id, done },
});

describe("byName", () => {
  it("sorts lists as people read their names, then in the order they were added", () => {
    const lists = [
      list("1", "List 10"),
      list("2", "list 2"),
      list("3", "Äpfel"),
      list("4", "Packing"),
      list("0", "Packing"),
    ];
    expect(byName(lists).map(({ id }) => id)).toStrictEqual(["3", "2", "1", "0", "4"]);
  });
});

describe("itemsOf", () => {
  it("gives a list's items to do, then those done, in the order they were added", () => {
    const items = [
      item("a", true),
      item("b", false),
      item("c", false, "packing"),
      item("d", false),
    ];
    const { toDo, done } = itemsOf("groceries", items);
    expect(toDo.map(({ id }) => id)).toStrictEqual(["b", "d"]);
    expect(done.map(({ id }) => id)).toStrictEqual(["a"]);
  });

  it("leaves out items whose list is gone, as after a merge (spec §3)", () => {
    expect(itemsOf("groceries", [item("a", false, null)])).toStrictEqual({ toDo: [], done: [] });
  });
});

describe("progressOf", () => {
  it("counts a list's items that are done, of all its items", () => {
    const items = [item("a", true), item("b", false), item("c", true, "packing")];
    expect(progressOf("groceries", items)).toStrictEqual({ done: 1, total: 2 });
    expect(progressOf("empty", items)).toStrictEqual({ done: 0, total: 0 });
  });
});

describe("neighbor", () => {
  it("is the next item, or else the one before, or nothing", () => {
    const section = [item("a", false), item("b", false), item("c", false)];
    expect(neighbor(section, "a")).toBe("b");
    expect(neighbor(section, "c")).toBe("b");
    expect(neighbor([item("a", false)], "a")).toBeUndefined();
    expect(neighbor(section, "z")).toBeUndefined();
  });
});
