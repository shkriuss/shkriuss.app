import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";
import { MANIFEST_FILE, parseManifest } from "@shkriuss/edge";
import { added, forget, load, open, read, write } from "./app.ts";

// Backup files in real browsers (backup format §3–§5): the backup worker encrypts and decrypts
// them under the production headers, at the work factor of new backups, which these tests check
// here rather than in unit tests, where it is slow.

/** The fixtures of `@shkriuss/backup`: its encrypted examples, which the age tool made. */
const FIXTURES = new URL("../../../packages/backup/src/test/", import.meta.url);
const EXAMPLE_PASSPHRASE = "burst-swarm-slender-curve-ability-various";

/** Whether `path` is the backup worker's bundle. */
function isWorker(path: string): boolean {
  return path.startsWith("/assets/age.worker-");
}

interface TestFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: readonly number[];
}

async function generate(page: Page): Promise<string> {
  return page.evaluate(() => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.backups.passphrase();
  });
}

async function make(page: Page, passphrase: string | null): Promise<TestFile> {
  return page.evaluate(async (with_) => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.backups.make(with_);
  }, passphrase);
}

async function restore(
  page: Page,
  bytes: readonly number[],
  passphrase: string | null,
): Promise<unknown> {
  return page.evaluate(
    async ([file, with_]) => {
      if (window.platform === undefined) {
        throw new Error("The test app has not loaded.");
      }
      return window.platform.backups.restore(file, with_);
    },
    [bytes, passphrase] as const,
  );
}

async function readExample(
  page: Page,
  bytes: readonly number[],
  passphrase: string,
): Promise<unknown> {
  return page.evaluate(
    async ([file, with_]) => {
      if (window.platform === undefined) {
        throw new Error("The test app has not loaded.");
      }
      return window.platform.backups.readExample(file, with_);
    },
    [bytes, passphrase] as const,
  );
}

test("an encrypted backup carries the records to another device", async ({ page }) => {
  await load(page);
  expect(await open(page, 1)).toBe("open");
  await write(page, ["Milk", "Eggs"]);
  const passphrase = await generate(page);
  expect(passphrase).toMatch(/^[a-z]+(?:-[a-z]+){5}$/);
  const file = await make(page, passphrase);
  expect(file.name).toMatch(/^shkriuss-platform-\d{4}-\d{2}-\d{2}\.age$/);
  expect(file.type).toBe("application/octet-stream");
  // One recipient stanza, of type scrypt, at the work factor of new backups (backup format §3).
  const [version, stanza, body, mac] = Buffer.from(file.bytes).toString("latin1").split("\n");
  expect(version).toBe("age-encryption.org/v1");
  expect(stanza).toMatch(/^-> scrypt [A-Za-z0-9+/]{22} 18$/);
  expect(body).toMatch(/^[A-Za-z0-9+/]{43}$/);
  expect(mac).toMatch(/^--- [A-Za-z0-9+/]{43}$/);

  // Another device: the same app with no data.
  await forget(page);
  expect(await open(page, 1)).toBe("open");
  // After a wrong passphrase, the user tries again with the same file (backup format §5.2).
  expect(await restore(page, file.bytes, `${passphrase}s`)).toEqual({
    ok: false,
    code: "wrong-passphrase",
  });
  expect(await restore(page, file.bytes, passphrase)).toEqual({
    ok: true,
    value: { preview: added(2), imported: added(2) },
  });
  expect(await read(page)).toEqual(["Eggs", "Milk"]);
});

test("a plain backup carries the records too", async ({ page }) => {
  await load(page);
  expect(await open(page, 1)).toBe("open");
  await write(page, ["Milk"]);
  const file = await make(page, null);
  expect(file.name).toMatch(/^shkriuss-platform-\d{4}-\d{2}-\d{2}\.json$/);
  expect(file.type).toBe("application/json");
  expect(JSON.parse(Buffer.from(file.bytes).toString("utf8"))).toMatchObject({
    format: "shkriuss-backup",
    formatVersion: 1,
    app: "platform",
    schemaVersion: 1,
  });
  await forget(page);
  expect(await open(page, 1)).toBe("open");
  expect(await restore(page, file.bytes, null)).toEqual({
    ok: true,
    value: { preview: added(1), imported: added(1) },
  });
  expect(await read(page)).toEqual(["Milk"]);
});

for (const fixture of ["example.age", "example.armored.age"]) {
  test(`reads ${fixture}, which the age command-line tool encrypted`, async ({ page }) => {
    const bytes = [...readFileSync(new URL(fixture, FIXTURES))];
    await load(page);
    expect(await readExample(page, bytes, `${EXAMPLE_PASSPHRASE}s`)).toEqual({
      ok: false,
      code: "wrong-passphrase",
    });
    expect(await readExample(page, bytes, EXAMPLE_PASSPHRASE)).toEqual({
      ok: true,
      value: { exported: "2026-10-04T21:13:20.000Z", records: { notes: 2, settings: 1 } },
    });
  });
}

test("only the backup worker includes age-encryption, which the page loads when it needs it", async ({
  request,
}) => {
  const manifest = parseManifest(await (await request.get(`/${MANIFEST_FILE}`)).text());
  const scripts = await Promise.all(
    [...manifest.keys()]
      .filter((path) => path.endsWith(".js"))
      .map(async (path) => ({ path, code: await (await request.get(path)).text() })),
  );
  for (const { path, code } of scripts) {
    // The label of age's scrypt stanzas, which only age-encryption has.
    expect(code.includes("age-encryption.org/v1/scrypt"), path).toBe(isWorker(path));
  }
  const workers = scripts.filter(({ path }) => isWorker(path));
  expect(workers).toHaveLength(1);
  // The words of generated passphrases, which only the page uses.
  expect(workers[0]?.code).not.toContain("abandon ability able");
  expect(scripts.some(({ code }) => code.includes("abandon ability able"))).toBe(true);
});
