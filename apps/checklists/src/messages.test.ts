import { createFormat } from "@shkriuss/i18n";
import { describe, expect, it } from "vitest";
import { messages } from "./messages.ts";

const m = messages(createFormat("en-US"));

describe("the text of a list's screen", () => {
  it("asks to confirm deleting a list with its items, or one with none", () => {
    expect(m.deleteListText(0)).toBe("The list is deleted. This cannot be undone.");
    expect(m.deleteListText(1)).toBe("The list and its 1 item are deleted. This cannot be undone.");
    expect(m.deleteListText(1234)).toBe(
      "The list and its 1,234 items are deleted. This cannot be undone.",
    );
  });

  it("says how much of a list is done, or that it has no items", () => {
    expect(m.progress(0, 0)).toBe("No items");
    expect(m.progress(2, 1234)).toBe("2 of 1,234 done");
  });

  it("says what a change did, and what it could not do", () => {
    expect(m.doneCleared(1)).toBe("1 done item cleared.");
    expect(m.doneCleared(3)).toBe("3 done items cleared.");
    expect(m.itemDeletedElsewhere()).toBe(
      "This item was deleted in another window or on another device.",
    );
    expect(m.listDeletedElsewhere()).toBe(
      "This list was deleted in another window or on another device.",
    );
  });
});
