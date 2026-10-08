import { describe, expect, it, vi } from "vitest";
import { m } from "../../messages.ts";
import { createDraftStore, isChecked, reloadWarning } from "./draft.ts";

describe("createDraftStore", () => {
  it("starts empty, in the variety it is given", () => {
    const draft = createDraftStore("british");
    expect(draft.getState()).toStrictEqual({
      text: "",
      variety: "british",
      ignored: new Set(),
      deleted: undefined,
      result: undefined,
    });
  });

  it("changes what it is told to, keeps the rest, and tells its listeners", () => {
    const draft = createDraftStore("american");
    const listener = vi.fn<() => void>();
    const stop = draft.subscribe(listener);
    draft.update({ text: "Their is a cat." });
    draft.update({ variety: "indian", deleted: "Hello." });
    expect(draft.getState()).toMatchObject({
      text: "Their is a cat.",
      variety: "indian",
      deleted: "Hello.",
    });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    draft.update({ text: "" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("gives the same draft until it changes, as React's useSyncExternalStore needs", () => {
    const draft = createDraftStore("american");
    const before = draft.getState();
    expect(draft.getState()).toBe(before);
    draft.update({ text: "Hello." });
    expect(draft.getState()).not.toBe(before);
    // The draft that React rendered stays as it was.
    expect(before.text).toBe("");
  });
});

describe("isChecked", () => {
  it("is whether the last check's mistakes are those of the text, in its variety", () => {
    const draft = createDraftStore("american");
    expect(isChecked(draft.getState())).toBe(false);
    draft.update({
      text: "The color.",
      result: { text: "The color.", variety: "american", mistakes: [] },
    });
    expect(isChecked(draft.getState())).toBe(true);
    draft.update({ variety: "british" });
    expect(isChecked(draft.getState())).toBe(false);
    draft.update({ variety: "american", text: "The colour." });
    expect(isChecked(draft.getState())).toBe(false);
  });
});

describe("reloadWarning", () => {
  it("says that a reload clears the text, once there is text", () => {
    const draft = createDraftStore("american");
    expect(reloadWarning(draft.getState())).toBeUndefined();
    // Undo's text alone is not worth a word.
    draft.update({ deleted: "Hello." });
    expect(reloadWarning(draft.getState())).toBeUndefined();
    draft.update({ text: "Hello." });
    expect(reloadWarning(draft.getState())).toBe(m.reloadWarning());
  });
});
