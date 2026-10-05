import {
  BackupError,
  type BackupErrorCode,
  createBackupFile,
  generatePassphrase,
  openBackupFile,
  readBackupFile,
} from "@shkriuss/backup";
import { type ImportCounts, type SchemaVersion, defineSchemas, field } from "@shkriuss/data";
import { current } from "./data.ts";

// Backup files (backup format §3–§5), made and read through the backup worker, with the data of
// `data.ts` and the example of backup format §2.

/** This test app's id in its backups. It is never deployed. */
const APP = "platform";

/** The app of backup format §2's example, whose encrypted fixtures the tests read. */
const EXAMPLE_APP = "notes";

const example = {
  version: 1,
  stores: {
    notes: { fields: { title: field.string({ maxLength: 100 }), done: field.boolean() } },
    settings: { fields: { sortBy: field.enum(["title", "date"]) } },
  },
} satisfies SchemaVersion;

const EXAMPLE_SCHEMAS = defineSchemas(example);

/** A file as the tests pass it between Node.js and the page. */
export interface TestFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: readonly number[];
}

/** What an operation gave, or the code of the BackupError that it threw. */
export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: BackupErrorCode };

/** What the end-to-end tests do with backup files. */
export interface BackupTests {
  /** A new generated passphrase. */
  passphrase(): string;
  /** A backup file of the open database, encrypted with `passphrase` unless it is `null`. */
  make(passphrase: string | null): Promise<TestFile>;
  /** Opens `bytes` as a backup file of this app, then previews and imports it: both totals. */
  restore(
    bytes: readonly number[],
    passphrase: string | null,
  ): Promise<Outcome<{ readonly preview: ImportCounts; readonly imported: ImportCounts }>>;
  /**
   * Reads `bytes` as a backup of the example's app, without importing it: when it was made, and
   * how many records each store has.
   */
  readExample(
    bytes: readonly number[],
    passphrase: string,
  ): Promise<
    Outcome<{ readonly exported: string; readonly records: Readonly<Record<string, number>> }>
  >;
}

async function outcome<T>(operation: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof BackupError) {
      return { ok: false, code: error.code };
    }
    throw error;
  }
}

export const backups: BackupTests = {
  passphrase: () => generatePassphrase(),
  async make(passphrase) {
    const file = await createBackupFile(current().database, { app: APP, passphrase });
    return {
      name: file.name,
      type: file.type,
      bytes: [...new Uint8Array(await file.arrayBuffer())],
    };
  },
  restore: async (bytes, passphrase) =>
    outcome(async () => {
      const { database, schemas } = current();
      const opened = await openBackupFile(new Blob([Uint8Array.from(bytes)]));
      const contents = await readBackupFile(opened, passphrase, {
        app: APP,
        schemas,
        now: Date.now(),
      });
      const preview = await database.previewImport(contents.incoming);
      return { preview: preview.total, imported: (await database.import(contents.incoming)).total };
    }),
  readExample: async (bytes, passphrase) =>
    outcome(async () => {
      const opened = await openBackupFile(new Blob([Uint8Array.from(bytes)]));
      const contents = await readBackupFile(opened, passphrase, {
        app: EXAMPLE_APP,
        schemas: EXAMPLE_SCHEMAS,
        now: Date.now(),
      });
      const records = Object.fromEntries(
        Object.entries(contents.incoming.stores).map(([store, all]) => [store, all.length]),
      );
      return { exported: contents.exported.toISOString(), records };
    }),
};
