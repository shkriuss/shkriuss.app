import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Database, Observable, Subscription } from "./db.ts";
import { DataLayerError } from "./errors.ts";
import { checkIncomingStores } from "./incoming.ts";
import { START, VERSION_1, fresh, open, type v1 } from "./test/storage.ts";

/** What an observation has given so far. */
interface Watched<T> {
  readonly values: T[];
  readonly errors: unknown[];
  readonly subscription: Subscription;
}

function watch<T>(observable: Observable<T>): Watched<T> {
  const values: T[] = [];
  const errors: unknown[] = [];
  const subscription = observable.subscribe({
    next(value) {
      values.push(value);
    },
    error(error) {
      errors.push(error);
    },
  });
  return { values, errors, subscription };
}

/** The titles of the notes, observed. */
function titles(db: Database<typeof v1>): Observable<string[]> {
  return db.observe(async (reader) =>
    (await reader.list("notes")).map(({ values }) => values.title),
  );
}

async function create(db: Database<typeof v1>, title: string): Promise<string> {
  return db.change(async (change) => change.create("notes", { title }));
}

describe("observe (architecture §7)", () => {
  it("gives the result, then a new one after each change that changes it", async () => {
    const { db } = await fresh();
    const watched = watch(titles(db));
    await vi.waitFor(() => {
      expect(watched.values).toStrictEqual([[]]);
    });

    const id = await create(db, "Milk");
    await vi.waitFor(() => {
      expect(watched.values.at(-1)).toStrictEqual(["Milk"]);
    });
    await db.change(async (change) => change.update("notes", id, { title: "Oat milk" }));
    await vi.waitFor(() => {
      expect(watched.values.at(-1)).toStrictEqual(["Oat milk"]);
    });
    await db.change(async (change) => change.delete("notes", id));
    await vi.waitFor(() => {
      expect(watched.values.at(-1)).toStrictEqual([]);
    });
    expect(watched.errors).toStrictEqual([]);
    watched.subscription.unsubscribe();
    db.close();
  });

  it("follows imports", async () => {
    const source = await fresh();
    await create(source.db, "Eggs");
    const { schemaVersion, stores } = await source.db.snapshot();
    source.db.close();

    const { db } = await fresh();
    const watched = watch(titles(db));
    await vi.waitFor(() => {
      expect(watched.values).toStrictEqual([[]]);
    });
    const backup: unknown = JSON.parse(JSON.stringify(stores));
    await db.import(checkIncomingStores(VERSION_1, schemaVersion, backup, START));
    await vi.waitFor(() => {
      expect(watched.values.at(-1)).toStrictEqual(["Eggs"]);
    });
    watched.subscription.unsubscribe();
    db.close();
  });

  it("follows changes made through another connection, as another tab makes them", async () => {
    const { db, factory } = await fresh();
    const other = await open(VERSION_1, factory);
    const watched = watch(titles(db));
    await vi.waitFor(() => {
      expect(watched.values).toStrictEqual([[]]);
    });
    await create(other, "Bread");
    await vi.waitFor(() => {
      expect(watched.values.at(-1)).toStrictEqual(["Bread"]);
    });
    watched.subscription.unsubscribe();
    other.close();
    db.close();
  });

  it("runs again only after changes to what it read", async () => {
    const { db } = await fresh();
    const [milk, eggs] = await db.change(async (change) => [
      await change.create("notes", { title: "Milk" }),
      await change.create("notes", { title: "Eggs" }),
    ]);
    let runs = 0;
    const watched = watch(
      db.observe(async (reader) => {
        runs += 1;
        return (await reader.get("notes", milk ?? ""))?.values.title;
      }),
    );
    await vi.waitFor(() => {
      expect(watched.values).toStrictEqual(["Milk"]);
    });

    // Another record of the same store, another store and the settings.
    await db.change(async (change) => change.update("notes", eggs ?? "", { title: "Two eggs" }));
    await db.change(async (change) => change.create("lists", { name: "Shopping" }));
    await db.change(async (change) => change.updateSettings({ sortBy: "date" }));
    // Then the record it read.
    await db.change(async (change) => change.update("notes", milk ?? "", { title: "Oat milk" }));
    await vi.waitFor(() => {
      expect(watched.values).toStrictEqual(["Milk", "Oat milk"]);
    });
    expect(runs).toBe(2);
    watched.subscription.unsubscribe();
    db.close();
  });

  it("gives nothing more once unsubscribed", async () => {
    const { db } = await fresh();
    const stopped = watch(titles(db));
    await vi.waitFor(() => {
      expect(stopped.values).toStrictEqual([[]]);
    });
    stopped.subscription.unsubscribe();

    await create(db, "Milk");
    // An observation that starts afterwards sees the change, and the stopped one never does.
    const watched = watch(titles(db));
    await vi.waitFor(() => {
      expect(watched.values).toStrictEqual([["Milk"]]);
    });
    expect(stopped.values).toStrictEqual([[]]);
    watched.subscription.unsubscribe();
    db.close();
  });

  it("ends with a DataLayerError when the query fails", async () => {
    const { db } = await fresh();
    const watched = watch(
      // @ts-expect-error -- A store the app lacks, which TypeScript refuses as well.
      db.observe(async (reader) => reader.list("tasks")),
    );
    await vi.waitFor(() => {
      expect(watched.errors).toHaveLength(1);
    });
    expect(watched.errors[0]).toBeInstanceOf(DataLayerError);
    expect(watched.errors[0]).toMatchObject({ code: "invalid" });
    expect(watched.values).toStrictEqual([]);
    db.close();
  });

  it("ends with a DataLayerError closed when the database is closed", async () => {
    const { db } = await fresh();
    db.close();
    const watched = watch(titles(db));
    await vi.waitFor(() => {
      expect(watched.errors).toHaveLength(1);
    });
    expect(watched.errors[0]).toBeInstanceOf(DataLayerError);
    expect(watched.errors[0]).toMatchObject({ code: "closed" });
  });

  it("lets queries read, and only read", () => {
    type QueryReader = Parameters<Parameters<Database<typeof v1>["observe"]>[0]>[0];
    expectTypeOf<QueryReader>().toHaveProperty("get");
    expectTypeOf<QueryReader>().toHaveProperty("list");
    expectTypeOf<QueryReader>().toHaveProperty("settings");
    expectTypeOf<QueryReader>().not.toHaveProperty("change");
    expectTypeOf<QueryReader>().not.toHaveProperty("import");
  });
});
