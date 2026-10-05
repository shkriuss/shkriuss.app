import {
  type Database,
  DataLayerError,
  type SchemaVersion,
  defineSchemas,
  field,
  openDatabase,
} from "@shkriuss/data";

// Two versions of a small app's data, for the tests of the data layer: the page plays either.

const v1 = {
  version: 1,
  stores: { notes: { fields: { title: field.string() } } },
} satisfies SchemaVersion;

/** Moves the notes to another store and renames their field, so version 1 lacks both. */
const v2 = {
  version: 2,
  stores: { memos: { fields: { text: field.string() } } },
  migrate: { notes: { store: "memos", rename: { title: "text" } } },
} satisfies SchemaVersion;

/** What the end-to-end tests do with the data layer. */
export interface DataTests {
  /**
   * Opens the database as version `version` of the app does. Resolves to `newer-version` if a
   * newer version of the app has upgraded it already.
   */
  open(version: 1 | 2): Promise<"open" | "newer-version">;
  /** Writes one note for each text, each in a change of its own, and returns their HLCs. */
  write(texts: readonly string[]): Promise<string[]>;
  /** The texts of the notes. */
  read(): Promise<string[]>;
  /** This device's id. */
  device(): Promise<string>;
  /** How many times other tabs needed the database closed. */
  versionChanges(): number;
}

let version1: Database<typeof v1> | undefined;
let version2: Database<typeof v2> | undefined;
let versionChanges = 0;

function opened(): Database<typeof v1> | Database<typeof v2> {
  const database = version2 ?? version1;
  if (database === undefined) {
    throw new Error("The database is not open.");
  }
  return database;
}

async function writeOne(text: string): Promise<string> {
  if (version2 !== undefined) {
    return version2.change(async (change) => {
      await change.create("memos", { text });
      return change.hlc;
    });
  }
  if (version1 === undefined) {
    throw new Error("The database is not open.");
  }
  return version1.change(async (change) => {
    await change.create("notes", { title: text });
    return change.hlc;
  });
}

export const data: DataTests = {
  async open(version) {
    const options = {
      onVersionChange: () => {
        versionChanges += 1;
      },
    };
    try {
      if (version === 1) {
        version1 = await openDatabase(defineSchemas(v1), options);
      } else {
        version2 = await openDatabase(defineSchemas(v1, v2), options);
      }
      return "open";
    } catch (error) {
      if (error instanceof DataLayerError && error.code === "newer-version") {
        return "newer-version";
      }
      throw error;
    }
  },
  // All at once, so that their transactions queue up together.
  write: async (texts) => Promise.all(texts.map(writeOne)),
  async read() {
    if (version2 !== undefined) {
      return (await version2.list("memos")).map(({ values }) => values.text);
    }
    if (version1 === undefined) {
      throw new Error("The database is not open.");
    }
    return (await version1.list("notes")).map(({ values }) => values.title);
  },
  async device() {
    return (await opened().device()).device;
  },
  versionChanges: () => versionChanges,
};
