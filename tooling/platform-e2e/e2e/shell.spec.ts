import { readFile, truncate, writeFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import type { StorageStatus, UpdateState } from "@shkriuss/pwa";
import { expect, test } from "@shkriuss/config/playwright";
import { forget, load, open as openData, read as readNotes } from "./app.ts";

// The shell of @shkriuss/shell in real browsers, under the production security headers, on the
// pages of src/shell-page.tsx: /shell, a screen of notes from the data layer in the app's frame,
// and /shell/settings. The fixture fails every test on a CSP violation, an error or a failed
// request.

/** Opens the shell's page with no notes yet. */
async function open(page: Page): Promise<void> {
  await page.goto("/shell");
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
}

async function setUpdateState(page: Page, state: UpdateState): Promise<void> {
  await page.evaluate((next) => {
    window.platform?.shell.setUpdateState(next);
  }, state);
}

/** Opens the settings, with the storage saying `status`. */
async function openSettings(page: Page, status: StorageStatus): Promise<void> {
  await page.goto("/shell/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.evaluate((next) => {
    window.platform?.shell.setStorageStatus(next);
  }, status);
}

async function answerPersistence(page: Page, kept: boolean): Promise<void> {
  await page.evaluate((answer) => {
    window.platform?.shell.answerPersistence(answer);
  }, kept);
}

const BEST_EFFORT: StorageStatus = {
  persistence: "best-effort",
  usage: 1_234_567,
  quota: 10_000_000_000,
};

/** The file that the page downloads while `action` runs: its name and its bytes. */
async function downloaded(
  page: Page,
  action: () => Promise<void>,
): Promise<{ readonly name: string; readonly bytes: number[] }> {
  const download = page.waitForEvent("download");
  await action();
  const file = await download;
  return { name: file.suggestedFilename(), bytes: [...(await readFile(await file.path()))] };
}

/** How many records each store of a backup file has, as this app reads it. */
async function recordsIn(
  page: Page,
  bytes: readonly number[],
  passphrase: string | null,
): Promise<unknown> {
  return page.evaluate(async ([file, secret]) => window.platform?.backups.read(file, secret), [
    bytes,
    passphrase,
  ] as const);
}

/**
 * Opens the dialog that makes a backup from the settings, and returns it with the passphrase it
 * offers.
 */
async function startBackup(page: Page): Promise<{ dialog: Locator; passphrase: string }> {
  await page
    .getByRole("region", { name: "Backups" })
    .getByRole("button", { name: "Back up", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Back up your data" });
  const passphrase = await dialog.getByText(/^[a-z]+(?:-[a-z]+){5}$/).textContent();
  return { dialog, passphrase: passphrase ?? "" };
}

/** What the share sheet of `fakeShareSheet()` got, and the function that answers it. */
interface ShareSheet {
  readonly shared: string[][];
  answer?: (cancelled: boolean) => void;
}

declare global {
  interface Window {
    shareSheet?: ShareSheet;
  }
}

/**
 * From the next page on, a share sheet that the test controls takes the place of the browser's,
 * which desktop browsers do not have for these files: it takes every file, and waits for
 * `answerShareSheet()`.
 */
async function fakeShareSheet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sheet: ShareSheet = { shared: [] };
    window.shareSheet = sheet;
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        sheet.shared.push((data.files ?? []).map((file) => file.name));
        await new Promise<void>((resolve, reject) => {
          sheet.answer = (cancelled) => {
            if (cancelled) {
              reject(new DOMException("Share canceled.", "AbortError"));
            } else {
              resolve();
            }
          };
        });
      },
    });
  });
}

/** The names of the files of each share so far. */
async function shared(page: Page): Promise<string[][]> {
  return page.evaluate(() => window.shareSheet?.shared ?? []);
}

/** The user shares the file in the share sheet, or closes it. */
async function answerShareSheet(page: Page, cancelled: boolean): Promise<void> {
  await page.evaluate((cancel) => {
    window.shareSheet?.answer?.(cancel);
  }, cancelled);
}

/** Makes a plain backup, which takes no time, and returns the dialog that offers to save it. */
async function makePlainBackup(page: Page): Promise<Locator> {
  const { dialog } = await startBackup(page);
  await dialog.getByRole("button", { name: "Make a plain backup instead" }).click();
  await page.getByRole("button", { name: "Make a plain backup" }).click();
  const ready = page.getByRole("dialog", { name: "Your backup is ready" });
  await expect(ready).toBeVisible();
  return ready;
}

/** The encrypted examples of `@shkriuss/backup`, of the app "notes", which the age tool made. */
const EXAMPLE = new URL("../../../packages/backup/src/test/example.age", import.meta.url);
const EXAMPLE_PASSPHRASE = "burst-swarm-slender-curve-ability-various";

interface BackupFile {
  readonly name: string;
  readonly bytes: readonly number[];
}

/**
 * A backup made on another device: the notes written into a new database of `version` of the
 * app, which the test app then forgets, so that the page that opens next starts empty.
 */
async function backupFromAnotherDevice(
  page: Page,
  notes: readonly string[],
  passphrase: string | null,
  version: 1 | 2 = 1,
): Promise<BackupFile> {
  await load(page);
  await openData(page, version);
  await write(page, notes);
  const file = await page.evaluate(
    async (secret) => window.platform?.backups.make(secret),
    passphrase,
  );
  await forget(page);
  if (file === undefined) {
    throw new Error("The test app has not loaded.");
  }
  return { name: file.name, bytes: [...file.bytes] };
}

/** Picks a file in the file picker that "Restore from a backup" opens: bytes, or a path. */
async function restoreFile(page: Page, file: BackupFile | string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Restore from a backup" }).click();
  await (
    await chooser
  ).setFiles(
    typeof file === "string"
      ? file
      : { name: file.name, mimeType: "application/octet-stream", buffer: Buffer.from(file.bytes) },
  );
}

/** The backup is made, which takes seconds: the key takes 256 MiB to derive. */
const MAKING = { timeout: 30_000 };

async function write(page: Page, titles: readonly string[]): Promise<void> {
  await page.evaluate(async (all) => {
    await window.platform?.data.write(all);
  }, titles);
}

/** The frame's banners: what its status region holds. */
function banners(page: Page): Locator {
  return page.getByRole("status").locator(":scope > *");
}

/** The reminder to back up, among the frame's banners. */
function reminder(page: Page): Locator {
  return banners(page).filter({ hasText: /^(?:No backup yet\.|Your last backup is from)/ });
}

/**
 * The app comes back into view, as when the user switches back to it. Browsers under test keep
 * their pages in view, so the test sends the event that the browser would.
 */
async function comeBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Saves the backup that the dialog `ready` offers, as a download, and closes the dialog. */
async function saveAndClose(page: Page, ready: Locator): Promise<void> {
  await downloaded(page, async () => {
    await ready.getByRole("button", { name: "Save backup" }).click();
  });
  const saved = page.getByRole("dialog", { name: "Backed up" });
  await saved.getByRole("button", { name: "Done" }).click();
  await expect(saved).toBeHidden();
}

const DAY = 24 * 60 * 60 * 1000;

/** What the stand-in for Chromium's install prompt saw, and the function that answers it. */
interface InstallPrompt {
  shown: number;
  answer?: (outcome: "accepted" | "dismissed") => void;
}

declare global {
  interface Window {
    installPrompt?: InstallPrompt;
  }
}

/**
 * The browser offers to install the app, as Chromium does with `beforeinstallprompt`, which test
 * browsers never fire: the event's prompt counts how often it shows, and waits for
 * `answerInstall()`.
 */
async function offerInstall(page: Page): Promise<void> {
  await page.evaluate(() => {
    const prompt: InstallPrompt = { shown: 0 };
    window.installPrompt = prompt;
    const userChoice = new Promise<{ outcome: string }>((resolve) => {
      prompt.answer = (outcome) => {
        resolve({ outcome });
      };
    });
    window.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {
          prompt.shown += 1;
        },
        userChoice,
      }),
    );
  });
}

async function answerInstall(page: Page, outcome: "accepted" | "dismissed"): Promise<void> {
  await page.evaluate((answer) => {
    window.installPrompt?.answer?.(answer);
  }, outcome);
}

/**
 * From the next page on, the browser is one on iPhone or iPad, whose `navigator.standalone` says
 * whether the page runs from the Home Screen.
 */
async function onIPhone(page: Page, homeScreen: boolean): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value });
  }, homeScreen);
}

/** The banner that suggests installing the app before anything is entered. */
function installFirst(page: Page): Locator {
  return banners(page).filter({ hasText: /^Before you start, add this app/ });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the frame and its banners have no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await open(page);
    await write(page, ["Milk"]);
    await setUpdateState(page, "update-available");
    await comeBack(page);
    await expect(reminder(page)).toBeVisible();
    await expect(banners(page)).toHaveCount(2);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the settings have no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openSettings(page, BEST_EFFORT);
    await expect(page.getByRole("button", { name: "Keep data on this device" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("the frame has the app's name, its sections and the screen as landmarks", async ({ page }) => {
  await open(page);
  // The app's name leads to its first screen, which shows: "/" in an app, which has no base path.
  const home = page.getByRole("banner").getByRole("link", { name: "Notes", exact: true });
  await expect(home).toHaveAttribute("href", "/shell/");
  await expect(home).toHaveAttribute("aria-current", "page");
  // The app's own sections, then the settings, which every app has.
  const sections = page.getByRole("navigation", { name: "Sections" });
  await expect(sections.getByRole("link")).toHaveText(["Archive", "Settings"]);
  await expect(sections.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "/shell/settings",
  );
  await expect(page.getByRole("main")).toContainText("No notes yet.");
  await expect(page).toHaveTitle("Notes");
});

/** Marks the page, so that `marked()` tells whether it has loaded again since. */
async function mark(page: Page): Promise<void> {
  await page.evaluate(() => {
    Reflect.set(window, "marked", true);
  });
}

async function marked(page: Page): Promise<boolean> {
  return page.evaluate(() => Reflect.get(window, "marked") === true);
}

test("a link opens another screen without loading the page, and its heading takes the focus", async ({
  page,
}) => {
  await open(page);
  await mark(page);
  const sections = page.getByRole("navigation", { name: "Sections" });
  await sections.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
  expect(new URL(page.url()).pathname).toBe("/shell/settings");
  await expect(page).toHaveTitle("Settings – Notes");
  await expect(sections.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const home = page.getByRole("banner").getByRole("link", { name: "Notes", exact: true });
  await expect(home).not.toHaveAttribute("aria-current");
  await home.click();
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeFocused();
  await expect(page).toHaveTitle("Notes");
  expect(await marked(page)).toBe(true);
});

test("a keyboard user follows a link with Enter, and the page does not load again", async ({
  page,
}) => {
  await open(page);
  await mark(page);
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Archive" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Archive" })).toBeFocused();
  await expect(page.getByRole("main")).toContainText("Nothing is archived.");
  expect(await marked(page)).toBe(true);
});

test("the browser's back and forward buttons go through the screens", async ({ page }) => {
  await open(page);
  await mark(page);
  const sections = page.getByRole("navigation", { name: "Sections" });
  await sections.getByRole("link", { name: "Archive" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Archive" })).toBeFocused();
  await sections.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Archive" })).toBeFocused();
  await expect(page).toHaveTitle("Archive – Notes");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "Archive" })).toBeFocused();
  expect(await marked(page)).toBe(true);
});

test("a link that the user opens with a modifier key is the browser's, as for a new tab", async ({
  page,
}) => {
  await open(page);
  const settings = page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Settings" });
  const prevented = await settings.evaluate((link) => {
    let defaultPrevented: boolean | undefined;
    // After the app's handlers, which React listens with at its root: the click stays here.
    addEventListener(
      "click",
      (event) => {
        defaultPrevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    return defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/shell");
});

test("an address that the app does not have says so, and leads to the app", async ({ page }) => {
  await page.goto("/shell/nowhere");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("This app has no page at this address.");
  await expect(page).toHaveTitle("Page not found – Notes");
  // In the frame, with its navigation.
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("main").getByRole("link", { name: "Go to Notes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeFocused();
  expect(new URL(page.url()).pathname).toBe("/shell/");
});

test("a keyboard user can skip to the screen first", async ({ page, browserName }) => {
  await open(page);
  // WebKit reaches links with Alt+Tab, as Safari does unless the user opts in to Tab.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.keyboard.press(tab);
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  // Without a new entry in the history.
  expect(new URL(page.url()).hash).toBe("");
});

test("the screen follows the notes as they change", async ({ page }) => {
  await open(page);
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await write(page, ["Milk"]);
  await expect(page.getByRole("listitem")).toHaveText(["Milk"]);
  await write(page, ["Eggs"]);
  await expect(page.getByRole("listitem")).toHaveText(["Eggs", "Milk"]);
});

test("the banner offers an update when one is ready, and applies it when the user agrees", async ({
  page,
}) => {
  await open(page);
  // The page's status region is there from the start, empty: screen readers read a banner that
  // appears in it, where one that appears as a live region of its own often goes unread.
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("status")).toBeEmpty();
  await setUpdateState(page, "update-available");
  const banner = page.getByRole("status");
  await expect(banner).toContainText("A new version of the app is ready.");
  await expect(banner.locator("[role=status], [aria-live], output")).toHaveCount(0);
  await banner.getByRole("button", { name: "Update" }).click();
  expect(await page.evaluate(() => window.platform?.shell.applied())).toBe(1);
  await setUpdateState(page, "updating");
  await expect(banner).toHaveText("Updating…");
  await expect(banner.getByRole("button")).toHaveCount(0);
});

test("the banner says what updating clears, for an app that keeps something only in the page", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.platform?.shell.setReloadWarning("Updating clears the draft.");
  });
  await setUpdateState(page, "update-available");
  const banner = page.getByRole("status");
  await expect(banner).toContainText(
    "A new version of the app is ready. Updating clears the draft.",
  );
  await setUpdateState(page, "outdated");
  await expect(banner).toContainText(
    "The app was updated in another window. Updating clears the draft.",
  );
  await page.evaluate(() => {
    window.platform?.shell.setReloadWarning(undefined);
  });
  await expect(banner).not.toContainText("clears");
  await expect(banner).toContainText("The app was updated in another window.");
});

test("the banner goes away until there is news, when the user says later", async ({ page }) => {
  await open(page);
  await setUpdateState(page, "update-available");
  await page.getByRole("button", { name: "Later" }).click();
  await expect(page.getByRole("status")).toBeEmpty();
  // The button that had the focus went with the banner: the focus goes to the screen.
  await expect(page.getByRole("main")).toBeFocused();
  // Another window updated the app: that is news.
  await setUpdateState(page, "outdated");
  const banner = page.getByRole("status");
  await expect(banner).toContainText("The app was updated in another window.");
  await banner.getByRole("button", { name: "Reload" }).click();
  expect(await page.evaluate(() => window.platform?.shell.applied())).toBe(1);
});

test("a screen that fails shows what happened in the frame, and reloads the app", async ({
  page,
}) => {
  await open(page);
  await setUpdateState(page, "update-available");
  await page.getByRole("button", { name: "Break this screen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Your data stays on this device.");
  await expect(page).toHaveTitle("Something went wrong – Notes");
  // The frame stays, with the update banner: a new version may fix it.
  await expect(page.getByRole("banner")).toContainText("Notes");
  await expect(page.getByRole("status")).toContainText("A new version of the app is ready.");
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Reload" }).click();
  await reloaded;
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
});

test("the settings say how much the app stores, and whether the browser keeps it", async ({
  page,
}) => {
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Storage" });
  await expect(section).toContainText("This app stores 1.2 MB on this device.");
  await expect(section.getByRole("status")).toHaveText(
    "Your browser may delete this data when the device runs low on space.",
  );
  // The settings read the status again when they open.
  expect(await page.evaluate(() => window.platform?.shell.storageRefreshes())).toBe(1);

  await openSettings(page, { persistence: "persisted", usage: 0, quota: 10_000_000_000 });
  await expect(section).toContainText("This app stores 0 bytes on this device.");
  await expect(section.getByRole("status")).toHaveText(
    "Your browser keeps this data until you delete it.",
  );
  await expect(section.getByRole("button")).toHaveCount(0);

  await openSettings(page, { persistence: "unknown", usage: undefined, quota: undefined });
  await expect(section).toContainText("Your browser does not say how much this app stores.");
  await expect(section.getByRole("status")).toHaveText(
    "Your browser does not say whether it keeps this data.",
  );
  await expect(section.getByRole("button")).toHaveCount(0);
});

test("the settings ask the browser to keep the data, when the user wants", async ({ page }) => {
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Storage" });
  const keep = section.getByRole("button", { name: "Keep data on this device" });
  await keep.click();
  // Firefox asks the user, which can take a while.
  await expect(keep).toHaveAttribute("aria-disabled", "true");
  await answerPersistence(page, true);
  await expect(section.getByRole("status")).toHaveText(
    "Your browser keeps this data until you delete it.",
  );
  await expect(keep).toHaveCount(0);
  // The focus goes to the section, not to the page, when the button goes away.
  await expect(section.getByRole("heading", { name: "Storage" })).toBeFocused();
});

test("the settings say so when the browser does not agree to keep the data", async ({ page }) => {
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Storage" });
  const keep = section.getByRole("button", { name: "Keep data on this device" });
  await keep.click();
  await answerPersistence(page, false);
  await expect(section.getByRole("status")).toHaveText(
    "Your browser did not agree to keep this data. Back it up to keep it safe.",
  );
  await expect(keep).toBeEnabled();
  await expect(keep).toBeFocused();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the backup dialog has no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openSettings(page, BEST_EFFORT);
    const { dialog } = await startBackup(page);
    await expect(dialog).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("a backup with the generated passphrase saves the notes, encrypted", async ({ page }) => {
  await openSettings(page, BEST_EFFORT);
  await write(page, ["Milk", "Eggs"]);
  const section = page.getByRole("region", { name: "Backups" });
  await expect(section).toContainText("No backup yet.");

  const { dialog, passphrase } = await startBackup(page);
  expect(passphrase).toMatch(/^[a-z]+(?:-[a-z]+){5}$/);
  await dialog.getByRole("button", { name: "Back up", exact: true }).click();
  const ready = page.getByRole("dialog", { name: "Your backup is ready" });
  await expect(ready).toBeVisible(MAKING);
  // The new step has the focus, not the page behind the dialog.
  await expect(ready.locator("[tabindex='-1']")).toBeFocused();

  const file = await downloaded(page, async () => {
    await ready.getByRole("button", { name: "Save backup" }).click();
  });
  expect(file.name).toMatch(/^shkriuss-platform-\d{4}-\d{2}-\d{2}\.age$/);
  const saved = page.getByRole("dialog", { name: "Backed up" });
  await expect(saved).toContainText(`Your backup is in your downloads, as ${file.name}.`);
  expect(await recordsIn(page, file.bytes, passphrase)).toStrictEqual({
    ok: true,
    value: { records: { notes: 2 } },
  });
  expect(await recordsIn(page, file.bytes, "not-the-passphrase")).toStrictEqual({
    ok: false,
    code: "wrong-passphrase",
  });

  await saved.getByRole("button", { name: "Done" }).click();
  await expect(saved).toBeHidden();
  await expect(section).toContainText("Last backup:");
  await expect(section).toContainText("Nothing has changed since then.");
  // A change after the backup is one that the next backup has to carry.
  await write(page, ["Bread"]);
  await openSettings(page, BEST_EFFORT);
  await expect(section).toContainText("1 change since then.");
});

test("a backup with the user's own passphrase checks it first", async ({ page }) => {
  await openSettings(page, BEST_EFFORT);
  await write(page, ["Milk"]);
  const { dialog } = await startBackup(page);
  await dialog.getByRole("button", { name: "Use my own passphrase" }).click();
  const own = page.getByRole("dialog", { name: "Your own passphrase" });
  const first = own.getByLabel("Passphrase", { exact: true });
  const second = own.getByLabel("Passphrase again");
  const backUp = own.getByRole("button", { name: "Back up" });

  await first.fill("too short");
  await second.fill("too short");
  await backUp.click();
  await expect(own).toContainText("Use at least 12 characters.");
  await expect(first).toBeFocused();

  // An error goes as soon as the user edits its field, so that nothing moves while they press.
  await first.fill("correct horse battery staple");
  await expect(own).not.toContainText("Use at least 12 characters.");
  await second.fill("correct horse battery stapel");
  await backUp.click();
  await expect(own).toContainText("The two passphrases are not the same.");
  await expect(second).toBeFocused();

  await second.fill("correct horse battery staple");
  await expect(own).not.toContainText("The two passphrases are not the same.");
  await backUp.click();
  const ready = page.getByRole("dialog", { name: "Your backup is ready" });
  await expect(ready).toBeVisible(MAKING);
  const file = await downloaded(page, async () => {
    await ready.getByRole("button", { name: "Save backup" }).click();
  });
  expect(await recordsIn(page, file.bytes, "correct horse battery staple")).toStrictEqual({
    ok: true,
    value: { records: { notes: 1 } },
  });
});

test("a plain backup comes only after a warning", async ({ page }) => {
  await openSettings(page, BEST_EFFORT);
  await write(page, ["Milk"]);
  const { dialog } = await startBackup(page);
  await dialog.getByRole("button", { name: "Make a plain backup instead" }).click();
  const plain = page.getByRole("dialog", { name: "A plain backup" });
  await expect(plain).toContainText("anyone who gets the file can read all of it");
  await plain.getByRole("button", { name: "Make a plain backup" }).click();
  const ready = page.getByRole("dialog", { name: "Your backup is ready" });
  const file = await downloaded(page, async () => {
    await ready.getByRole("button", { name: "Save backup" }).click();
  });
  expect(file.name).toMatch(/^shkriuss-platform-\d{4}-\d{2}-\d{2}\.json$/);
  expect(await recordsIn(page, file.bytes, null)).toStrictEqual({
    ok: true,
    value: { records: { notes: 1 } },
  });
});

test("a backup that the user cancels saves nothing, and records nothing", async ({ page }) => {
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Backups" });
  const { dialog } = await startBackup(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  // The focus goes back to the button that opened the dialog.
  await expect(section.getByRole("button", { name: "Back up" })).toBeFocused();

  // Escape closes it too, even once the backup is ready to save.
  await startBackup(page);
  await page
    .getByRole("dialog", { name: "Back up your data" })
    .getByRole("button", { name: "Make a plain backup instead" })
    .click();
  await page.getByRole("button", { name: "Make a plain backup" }).click();
  await expect(page.getByRole("dialog", { name: "Your backup is ready" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(section).toContainText("No backup yet.");
});

test("a backup started again after the dialog was closed saves only the new one", async ({
  page,
}) => {
  await openSettings(page, BEST_EFFORT);
  await write(page, ["Milk"]);
  const earlier = await startBackup(page);
  await earlier.dialog.getByRole("button", { name: "Back up", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Making your backup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The earlier backup finishes while the new one is being made, and must not take its place:
  // its file would need the passphrase that the user no longer has in front of them.
  const later = await startBackup(page);
  expect(later.passphrase).not.toBe(earlier.passphrase);
  await later.dialog.getByRole("button", { name: "Back up", exact: true }).click();
  const ready = page.getByRole("dialog", { name: "Your backup is ready" });
  await expect(ready).toBeVisible(MAKING);
  const file = await downloaded(page, async () => {
    await ready.getByRole("button", { name: "Save backup" }).click();
  });
  expect(await recordsIn(page, file.bytes, later.passphrase)).toStrictEqual({
    ok: true,
    value: { records: { notes: 1 } },
  });
});

test("where the browser can share the file, the share sheet takes the backup, once", async ({
  page,
}) => {
  await fakeShareSheet(page);
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Backups" });
  const ready = await makePlainBackup(page);
  const save = ready.getByRole("button", { name: "Save backup" });
  await save.click();
  // The button waits while the share sheet is open, and a second press does nothing.
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await save.click({ force: true });
  expect(await shared(page)).toStrictEqual([
    [expect.stringMatching(/^shkriuss-platform-.*\.json$/)],
  ]);

  await answerShareSheet(page, false);
  await expect(page.getByRole("dialog", { name: "Backed up" })).toContainText(
    "Your backup is saved. Keep it somewhere other than this device.",
  );
  await expect(section).toContainText("Last backup:");
});

test("a share sheet that the user closes saves nothing, and records nothing", async ({ page }) => {
  await fakeShareSheet(page);
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Backups" });
  const ready = await makePlainBackup(page);
  const save = ready.getByRole("button", { name: "Save backup" });
  await save.click();
  await answerShareSheet(page, true);
  await expect(ready.getByRole("status")).toHaveText("The backup is not saved yet.");
  await expect(save).toBeEnabled();
  await expect(section).toContainText("No backup yet.");
});

test("an encrypted backup from another device restores its notes, with its passphrase", async ({
  page,
}) => {
  const passphrase = "correct horse battery staple";
  const file = await backupFromAnotherDevice(page, ["Milk", "Eggs"], passphrase);
  await openSettings(page, BEST_EFFORT);
  await restoreFile(page, file);
  const encrypted = page.getByRole("dialog", { name: "This backup is encrypted" });
  const field = encrypted.getByLabel("Passphrase");
  const openFile = encrypted.getByRole("button", { name: "Open" });
  await expect(field).toBeFocused();

  await openFile.click();
  await expect(encrypted).toContainText("Enter the passphrase.");
  await field.fill("not the passphrase");
  await expect(encrypted).not.toContainText("Enter the passphrase.");
  await openFile.click();
  // The user tries again, with the same file (backup format §5.2).
  await expect(encrypted).toContainText("The passphrase is wrong. Try again.", MAKING);
  await expect(field).toBeFocused();
  await field.fill(passphrase);
  await openFile.click();

  const preview = page.getByRole("dialog", { name: "Restore this backup?" });
  await expect(preview).toContainText("Restoring it brings 2 new.", MAKING);
  await expect(preview).toContainText("This backup was made on");
  // Nothing is written before the user agrees (§5.6).
  expect(await readNotes(page)).toStrictEqual([]);
  await preview.getByRole("button", { name: "Restore" }).click();
  const restored = page.getByRole("dialog", { name: "Restored" });
  await expect(restored).toContainText("Restored: 2 new.");
  await restored.getByRole("button", { name: "Done" }).click();
  expect(await readNotes(page)).toStrictEqual(["Eggs", "Milk"]);
});

test("a plain backup restores without a passphrase, and a second time brings nothing", async ({
  page,
}) => {
  const file = await backupFromAnotherDevice(page, ["Milk"], null);
  await openSettings(page, BEST_EFFORT);
  await restoreFile(page, file);
  const preview = page.getByRole("dialog", { name: "Restore this backup?" });
  await expect(preview).toContainText("Restoring it brings 1 new.");
  await preview.getByRole("button", { name: "Restore" }).click();
  await page
    .getByRole("dialog", { name: "Restored" })
    .getByRole("button", { name: "Done" })
    .click();

  await restoreFile(page, file);
  await expect(preview).toContainText("This device already has everything in this backup.");
  await expect(preview.getByRole("button", { name: "Restore" })).toHaveCount(0);
  await preview.getByRole("button", { name: "Close" }).click();
  expect(await readNotes(page)).toStrictEqual(["Milk"]);
});

test("a backup that the user does not restore changes nothing", async ({ page }) => {
  const file = await backupFromAnotherDevice(page, ["Milk"], null);
  await openSettings(page, BEST_EFFORT);
  await restoreFile(page, file);
  const preview = page.getByRole("dialog", { name: "Restore this backup?" });
  await preview.getByRole("button", { name: "Cancel" }).click();
  await expect(preview).toBeHidden();
  expect(await readNotes(page)).toStrictEqual([]);
});

test("a backup whose changes are dated ahead says so, and restores elsewhere once the user confirms their date", async ({
  page,
}) => {
  // This device's date was two days ahead when it wrote a note, and is right again: its changes
  // carry that date until it comes (data model §3.3, §3.5).
  const now = Date.now();
  await page.clock.setFixedTime(now + 2 * DAY);
  await openSettings(page, BEST_EFFORT);
  await write(page, ["Milk"]);
  await page.clock.setFixedTime(now);
  const ready = await makePlainBackup(page);
  await expect(ready).toContainText(
    /Some changes in it are dated up to \S.*, more than a day ahead of this device's clock\. If the clock is wrong, correct it\. If not, restoring this backup will ask you to confirm those dates\./,
  );
  const file = await downloaded(page, async () => {
    await ready.getByRole("button", { name: "Save backup" }).click();
  });

  // Another device, whose date is right.
  await load(page);
  await forget(page);
  await openSettings(page, BEST_EFFORT);
  await restoreFile(page, { name: file.name, bytes: file.bytes });
  const preview = page.getByRole("dialog", { name: "Restore this backup?" });
  await expect(preview).toContainText("Restoring it brings 1 new.");
  await expect(preview).toContainText(
    /Some changes in it are dated up to \S.*, more than a day ahead of this device's clock\. If the clock is wrong, correct it first\. If not, the backup comes from a device whose clock was set ahead: restoring it anyway gives this device's changes that date too, until it comes\./,
  );
  await expect(preview.getByRole("button", { name: "Restore", exact: true })).toHaveCount(0);
  await preview.getByRole("button", { name: "Restore anyway" }).click();
  const restored = page.getByRole("dialog", { name: "Restored" });
  await expect(restored).toContainText("Restored: 1 new.");
  await restored.getByRole("button", { name: "Done" }).click();
  expect(await readNotes(page)).toStrictEqual(["Milk"]);
});

test("a file that this app cannot restore is refused, with what happened", async ({
  page,
}, testInfo) => {
  const newer = await backupFromAnotherDevice(page, ["Milk"], null, 2);
  const encrypted = await backupFromAnotherDevice(page, ["Milk"], EXAMPLE_PASSPHRASE);
  await openSettings(page, BEST_EFFORT);
  const refused = page.getByRole("dialog", { name: "Not restored" });

  async function refusedWith(message: string): Promise<void> {
    await expect(refused).toContainText(message, MAKING);
    await refused.getByRole("button", { name: "Close" }).click();
    await expect(refused).toBeHidden();
  }

  await restoreFile(page, { name: "notes.txt", bytes: [...Buffer.from("Milk, eggs")] });
  await refusedWith("This is not a backup file.");

  // Larger than any backup can be, refused before it is read (backup format §5.1).
  const huge = testInfo.outputPath("huge.age");
  await writeFile(huge, "");
  await truncate(huge, 64 * 1024 * 1024 + 1);
  await restoreFile(page, huge);
  await refusedWith("The file is too large to be a backup.");

  await restoreFile(page, newer);
  await refusedWith(
    "The backup was made by a newer version of the app. Update the app and try again.",
  );

  const example = await readFile(EXAMPLE);
  await restoreFile(page, { name: "shkriuss-notes-2026-10-04.age", bytes: [...example] });
  const passphrase = page.getByRole("dialog", { name: "This backup is encrypted" });
  await passphrase.getByLabel("Passphrase").fill(EXAMPLE_PASSPHRASE);
  await passphrase.getByRole("button", { name: "Open" }).click();
  await refusedWith("This is a backup of the app “notes”, not of this one.");

  // A changed byte near the end of an encrypted backup, which age authenticates (§3).
  const damaged = [...encrypted.bytes];
  const last = damaged.length - 2;
  damaged[last] = (damaged[last] ?? 0) ^ 0xff;
  await restoreFile(page, { name: encrypted.name, bytes: damaged });
  await passphrase.getByLabel("Passphrase").fill(EXAMPLE_PASSPHRASE);
  await passphrase.getByRole("button", { name: "Open" }).click();
  await refusedWith("The file is damaged or not supported.");

  expect(await readNotes(page)).toStrictEqual([]);
});

test("the reminder asks for a first backup once there is data, when the app opens or comes back", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await write(page, ["Milk"]);
  await expect(page.getByRole("listitem")).toHaveText(["Milk"]);
  // Never in the middle of a task: a change does not bring it.
  await expect(reminder(page)).toHaveCount(0);
  await comeBack(page);
  await expect(reminder(page)).toHaveText(/^No backup yet\. Back up your data to keep it safe\./);
  await page.reload();
  await expect(reminder(page)).toHaveText(/^No backup yet\./);
});

test("the reminder comes when the app opens on the settings, which read the status as well", async ({
  page,
}) => {
  await open(page);
  await write(page, ["Milk"]);
  // The settings and the reminder both read the status as the page opens.
  await openSettings(page, BEST_EFFORT);
  await expect(page.getByRole("region", { name: "Backups" })).toContainText("No backup yet.");
  await expect(reminder(page)).toHaveText(/^No backup yet\. Back up your data to keep it safe\./);
});

test("the reminder's backup takes the reminder away, and the focus goes to the screen", async ({
  page,
}) => {
  await open(page);
  await write(page, ["Milk"]);
  await page.reload();
  const backUp = reminder(page).getByRole("button", { name: "Back up" });
  // A dialog that the user cancels gives the focus back to the reminder, which stays.
  await backUp.click();
  const dialog = page.getByRole("dialog", { name: "Back up your data" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(backUp).toBeFocused();

  await backUp.click();
  await dialog.getByRole("button", { name: "Make a plain backup instead" }).click();
  await page.getByRole("button", { name: "Make a plain backup" }).click();
  const ready = page.getByRole("dialog", { name: "Your backup is ready" });
  const file = await downloaded(page, async () => {
    await ready.getByRole("button", { name: "Save backup" }).click();
  });
  expect(await recordsIn(page, file.bytes, null)).toStrictEqual({
    ok: true,
    value: { records: { notes: 1 } },
  });
  const saved = page.getByRole("dialog", { name: "Backed up" });
  await expect(saved).toBeVisible();
  // The reminder goes once the backup is recorded, and its dialog stays.
  await expect(reminder(page)).toHaveCount(0);
  await saved.getByRole("button", { name: "Done" }).click();
  await expect(saved).toBeHidden();
  // The button that opened the dialog went with the reminder: the focus goes to the screen.
  await expect(page.getByRole("main")).toBeFocused();

  await openSettings(page, BEST_EFFORT);
  await expect(page.getByRole("region", { name: "Backups" })).toContainText(
    "Nothing has changed since then.",
  );
  await expect(reminder(page)).toHaveCount(0);
});

test("the reminder comes a week after the last backup if anything changed, and Later hides it for a day", async ({
  page,
}) => {
  const made = Date.UTC(2026, 9, 6, 10, 0);
  await page.clock.setFixedTime(made);
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Backups" });
  await write(page, ["Milk"]);
  await saveAndClose(page, await makePlainBackup(page));
  await write(page, ["Eggs"]);

  // Six days later, the backup is recent enough.
  await page.clock.setFixedTime(made + 6 * DAY);
  await comeBack(page);
  await expect(section).toContainText("1 change since then.");
  await expect(reminder(page)).toHaveCount(0);

  // A week later, the reminder comes, with what the backup lacks.
  await page.clock.setFixedTime(made + 7 * DAY);
  await comeBack(page);
  await expect(reminder(page)).toHaveText(
    /^Your last backup is from \S.*2026, and 1 change is not in it\./,
  );
  await reminder(page).getByRole("button", { name: "Later" }).click();
  await expect(reminder(page)).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();

  // Later hides it for a day.
  await write(page, ["Bread"]);
  await page.clock.setFixedTime(made + 8 * DAY - 1);
  await comeBack(page);
  await expect(section).toContainText("2 changes since then.");
  await expect(reminder(page)).toHaveCount(0);
  await page.clock.setFixedTime(made + 8 * DAY);
  await comeBack(page);
  await expect(reminder(page)).toHaveText(/and 2 changes are not in it\./);

  // A backup made in the settings takes it away.
  await saveAndClose(page, await makePlainBackup(page));
  await expect(section).toContainText("Nothing has changed since then.");
  await expect(reminder(page)).toHaveCount(0);
});

test("a reminder that the user put off comes again when the app opens again", async ({ page }) => {
  await open(page);
  await write(page, ["Milk"]);
  await page.reload();
  await reminder(page).getByRole("button", { name: "Later" }).click();
  await expect(reminder(page)).toHaveCount(0);
  await page.reload();
  await expect(reminder(page)).toHaveText(/^No backup yet\./);
});

test("a restore does not bring the reminder in the middle of the task: the next check does", async ({
  page,
}) => {
  const file = await backupFromAnotherDevice(page, ["Eggs"], null);
  // From now on, the test sets the time, after that of the other device's backup.
  const made = Date.now();
  await page.clock.setFixedTime(made);
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Backups" });
  await write(page, ["Milk"]);
  await saveAndClose(page, await makePlainBackup(page));

  // A week later, with nothing changed since the backup: no reminder.
  await page.clock.setFixedTime(made + 7 * DAY);
  await openSettings(page, BEST_EFFORT);
  await expect(section).toContainText("Nothing has changed since then.");
  await expect(reminder(page)).toHaveCount(0);

  await restoreFile(page, file);
  await page
    .getByRole("dialog", { name: "Restore this backup?" })
    .getByRole("button", { name: "Restore" })
    .click();
  await page
    .getByRole("dialog", { name: "Restored" })
    .getByRole("button", { name: "Done" })
    .click();
  await expect(section).toContainText("1 change since then.");
  await expect(reminder(page)).toHaveCount(0);
  await comeBack(page);
  await expect(reminder(page)).toHaveText(/and 1 change is not in it\./);
});

test("the settings offer the browser's install prompt, and say when the app is installed", async ({
  page,
}) => {
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Install" });
  // Before the browser offers anything, the settings point to its menu.
  await expect(section).toContainText("Some browsers install apps from their menu");
  await expect(section.getByRole("button")).toHaveCount(0);
  await offerInstall(page);
  await section.getByRole("button", { name: "Install" }).click();
  expect(await page.evaluate(() => window.installPrompt?.shown)).toBe(1);
  await answerInstall(page, "accepted");
  await expect(section).toContainText("This app is installed on this device.");
  await expect(section.getByRole("button")).toHaveCount(0);
  // The button went away: the focus goes to the section, whose text says what changed.
  await expect(section.getByRole("heading", { name: "Install" })).toBeFocused();
});

test("an install prompt that the user dismissed is spent, and the settings point to the menu", async ({
  page,
}) => {
  await openSettings(page, BEST_EFFORT);
  const section = page.getByRole("region", { name: "Install" });
  await offerInstall(page);
  await section.getByRole("button", { name: "Install" }).click();
  await answerInstall(page, "dismissed");
  await expect(section).toContainText("Some browsers install apps from their menu");
  await expect(section.getByRole("button")).toHaveCount(0);
  expect(await page.evaluate(() => window.installPrompt?.shown)).toBe(1);
});

test("on iPhone and iPad, the settings say how to add the app to the Home Screen, and take the data along", async ({
  page,
}) => {
  await onIPhone(page, false);
  await openSettings(page, BEST_EFFORT);
  await expect(page.getByRole("region", { name: "Install" })).toContainText(
    "open your browser's share menu, then choose Add to Home Screen. The app there keeps its own data, apart from your browser's: to take your data along, back it up here, then restore the backup in the app.",
  );
});

test("on iPhone and iPad, a banner suggests installing before anything is entered, and not after", async ({
  page,
}) => {
  await onIPhone(page, false);
  await open(page);
  await expect(installFirst(page)).toContainText(
    "Before you start, add this app to your Home Screen: there it keeps its own data, apart from your browser's.",
  );
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await installFirst(page).getByRole("button", { name: "Later" }).click();
  await expect(installFirst(page)).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
  // Later lasts until the app opens again.
  await page.reload();
  await expect(installFirst(page)).toBeVisible();
  // Once there is data, the next check brings the backup reminder instead.
  await write(page, ["Milk"]);
  await comeBack(page);
  await expect(reminder(page)).toBeVisible();
  await expect(installFirst(page)).toHaveCount(0);
});

test("an app on the Home Screen suggests no install, and says that it is installed", async ({
  page,
}) => {
  await onIPhone(page, true);
  await open(page);
  // The app knows that it runs installed from the start, whatever a check finds.
  await comeBack(page);
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await expect(installFirst(page)).toHaveCount(0);
  await openSettings(page, BEST_EFFORT);
  await expect(page.getByRole("region", { name: "Install" })).toContainText(
    "This app is installed on this device.",
  );
});

test("the settings say what the app is, where its data stays, and where its source code is", async ({
  page,
}) => {
  await openSettings(page, BEST_EFFORT);
  const about = page.getByRole("region", { name: "About Notes" });
  await expect(about).toContainText("Notes that stay on this device, to test the shell.");
  await expect(about).toContainText(
    "Your data stays on this device. The app has no accounts, and sends none of your data anywhere: only the backups that you save leave the device.",
  );
  await expect(about).toContainText(
    "This app is free software, under the GNU Affero General Public License, version 3.",
  );
  // Each in a new tab: an app installed on an iPhone has no back button to return from them.
  for (const [name, href] of [
    ["Source code", "https://github.com/shkriuss/shkriuss.app"],
    ["Report a security problem", "https://github.com/shkriuss/shkriuss.app/security/policy"],
  ] as const) {
    const link = about.getByRole("link", { name });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noreferrer");
  }
  // The licenses show in the app, from its own file, which the service worker keeps offline.
  const show = about.getByRole("button", { name: "Licenses of the software it includes" });
  await show.click();
  const licenses = page.getByRole("dialog", { name: "Licenses" });
  await expect(licenses).toContainText(/^dexie \d+\.\d+\.\d+ \(Apache-2\.0\)$/m);
  // At the top of the text, which the keyboard scrolls from there.
  await expect(licenses.locator("[tabindex='-1']")).toBeFocused();
  expect(await licenses.evaluate((dialog) => dialog.scrollTop)).toBe(0);
  await page.keyboard.press("PageDown");
  await expect.poll(async () => licenses.evaluate((dialog) => dialog.scrollTop)).toBeGreaterThan(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await licenses.getByRole("button", { name: "Close" }).click();
  await expect(licenses).toBeHidden();
  await expect(show).toBeFocused();
});
