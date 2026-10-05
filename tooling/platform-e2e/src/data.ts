import {
  DATABASE_NAME,
  type Database,
  DataLayerError,
  type ImportCounts,
  type SchemaVersion,
  checkIncomingStores,
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

const SCHEMAS_1 = defineSchemas(v1);
const SCHEMAS_2 = defineSchemas(v1, v2);

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
  /** Every record, as a backup carries them: the schema version and the stores, as JSON. */
  backup(): Promise<string>;
  /** Checks what `backup()` gave, previews it and imports it: the totals of both. */
  restore(
    backup: string,
  ): Promise<{ readonly preview: ImportCounts; readonly imported: ImportCounts }>;
  /** Closes the database and deletes it, so that the app is new on this device. */
  forget(): Promise<void>;
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
        version1 = await openDatabase(SCHEMAS_1, options);
      } else {
        version2 = await openDatabase(SCHEMAS_2, options);
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
  backup: async () => JSON.stringify(await opened().snapshot()),
  async restore(backup) {
    const parsed: unknown = JSON.parse(backup);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("schemaVersion" in parsed) ||
      !("stores" in parsed) ||
      typeof parsed.schemaVersion !== "number"
    ) {
      throw new Error("This is not what backup() gives.");
    }
    const { schemaVersion, stores } = parsed;
    const now = Date.now();
    if (version2 !== undefined) {
      const incoming = checkIncomingStores(SCHEMAS_2, schemaVersion, stores, now);
      const preview = await version2.previewImport(incoming);
      return { preview: preview.total, imported: (await version2.import(incoming)).total };
    }
    if (version1 === undefined) {
      throw new Error("The database is not open.");
    }
    const incoming = checkIncomingStores(SCHEMAS_1, schemaVersion, stores, now);
    const preview = await version1.previewImport(incoming);
    return { preview: preview.total, imported: (await version1.import(incoming)).total };
  },
  async forget() {
    version1?.close();
    version2?.close();
    version1 = undefined;
    version2 = undefined;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.addEventListener("success", () => {
        resolve();
      });
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("The database could not be deleted."));
      });
      request.addEventListener("blocked", () => {
        reject(new Error("Another tab keeps the database open."));
      });
    });
  },
};
