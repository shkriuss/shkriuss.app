import { DataLayerError } from "@shkriuss/data";
import { describe, expect, it } from "vitest";
import { failureShownWith, writeFailure } from "./failures.ts";

const TEXTS = { otherwise: "The change could not be saved.", deleted: "The item was deleted." };

describe("writeFailure", () => {
  it("says that the device has no space left, whatever else the write was to", () => {
    const full = new DataLayerError("storage-full", "The quota has been exceeded.");
    expect(writeFailure(full, TEXTS)).toBe(
      "This device has no space left for the app's data. Free some space, then try again.",
    );
    expect(writeFailure(full, { otherwise: TEXTS.otherwise })).toBe(
      "This device has no space left for the app's data. Free some space, then try again.",
    );
  });

  it("says that the record was deleted meanwhile, where the write was to one", () => {
    const deleted = new DataLayerError("deleted", "Record x is deleted and cannot be updated.");
    expect(writeFailure(deleted, TEXTS)).toBe("The item was deleted.");
  });

  it("says otherwise of a write that creates a record, which no deletion stops", () => {
    const deleted = new DataLayerError("deleted", "Record x is deleted and cannot be updated.");
    expect(writeFailure(deleted, { otherwise: TEXTS.otherwise })).toBe(
      "The change could not be saved.",
    );
  });

  it("says otherwise of every other failure", () => {
    expect(writeFailure(new DataLayerError("closed", "The database is closed."), TEXTS)).toBe(
      "The change could not be saved.",
    );
    expect(writeFailure(new DataLayerError("not-found", "No record x."), TEXTS)).toBe(
      "The change could not be saved.",
    );
    expect(writeFailure(new Error("deleted"), TEXTS)).toBe("The change could not be saved.");
    expect(writeFailure(undefined, TEXTS)).toBe("The change could not be saved.");
  });
});

describe("failureShownWith", () => {
  const items = [{ id: "milk" }, { id: "eggs" }];

  it("keeps a failure while the item that it concerns shows", () => {
    const failure = { message: "The item was deleted.", item: "milk" };
    expect(failureShownWith(failure, items)).toBe(failure);
  });

  it("drops a failure once the item that it concerns is gone, as the screen shows that", () => {
    expect(
      failureShownWith({ message: "The item was deleted.", item: "bread" }, items),
    ).toBeUndefined();
    expect(
      failureShownWith({ message: "The item was deleted.", item: "milk" }, []),
    ).toBeUndefined();
  });

  it("keeps a failure that concerns no item, and none", () => {
    const failure = { message: "The item could not be added." };
    expect(failureShownWith(failure, items)).toBe(failure);
    expect(failureShownWith(failure, [])).toBe(failure);
    expect(failureShownWith(undefined, items)).toBeUndefined();
  });
});
