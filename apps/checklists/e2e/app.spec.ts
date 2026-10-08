import { readFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";
import { m } from "../src/messages.ts";

// Checklists in real browsers (docs/specs/apps/checklists.md §5): its production build, with its
// real service worker, data layer and backup worker, under the production security headers. The
// fixture fails every test on a CSP violation, an error or a failed request.

const NAME = m.appName();
const DESCRIPTION = m.appDescription();

/** Text as the build writes it into the page: in its head, escaped as HTML. */
function escaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Opens the app on its lists, at `url`. */
async function open(page: Page, url = "/"): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
}

/** The lists on the first screen: each a link, with the list's name and how much is done. */
function lists(page: Page): Locator {
  return page.getByRole("list", { name: "Lists" }).getByRole("link");
}

/** Adds a list on the first screen, which opens it; returns its id, from its address. */
async function addList(page: Page, name: string): Promise<string> {
  await page.getByRole("textbox", { name: "New list" }).fill(name);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeFocused();
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

/** Goes back to the lists, with the frame's link. */
async function toLists(page: Page): Promise<void> {
  await page.getByRole("banner").getByRole("link", { name: NAME }).click();
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeFocused();
}

/** A list's items to do, or those done. */
function section(page: Page, name: "To do" | "Done"): Locator {
  return page.getByRole("list", { name, exact: true });
}

/** The texts of a section's items, in their order. */
function texts(page: Page, name: "To do" | "Done"): Locator {
  return section(page, name).locator("label");
}

/** An item's checkbox, in whichever section it is. */
function checkbox(page: Page, text: string): Locator {
  return page.getByRole("checkbox", { name: text, exact: true });
}

/** An item's label, which the pointer presses, as the checkbox itself is hidden in it. */
function label(page: Page, text: string): Locator {
  return page.locator("label").filter({ has: checkbox(page, text) });
}

/** What the list's screen last said to screen readers. */
function status(page: Page): Locator {
  return page.getByRole("main").getByRole("status");
}

async function addItem(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: "New item" }).fill(text);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(section(page, "To do").getByRole("checkbox", { name: text })).toBeVisible();
}

/** Ticks an item off or back, and waits until it is in its new section. */
async function tick(page: Page, text: string): Promise<void> {
  const ticked = !(await checkbox(page, text).isChecked());
  await label(page, text).click();
  await expect(
    section(page, ticked ? "Done" : "To do").getByRole("checkbox", { name: text }),
  ).toBeVisible();
}

/** Opens an item's dialog. */
async function edit(page: Page, text: string): Promise<Locator> {
  await page.getByRole("button", { name: `Edit “${text}”` }).click();
  const dialog = page.getByRole("dialog", { name: `Edit “${text}”` });
  await expect(dialog.getByRole("textbox", { name: "Text" })).toBeFocused();
  return dialog;
}

async function renameItem(page: Page, from: string, to: string): Promise<void> {
  const dialog = await edit(page, from);
  await dialog.getByRole("textbox", { name: "Text" }).fill(to);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(checkbox(page, to)).toBeVisible();
}

async function deleteItem(page: Page, text: string): Promise<void> {
  const dialog = await edit(page, text);
  await dialog.getByRole("button", { name: "Delete item" }).click();
  await expect(checkbox(page, text)).toHaveCount(0);
}

async function renameList(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole("button", { name: "Rename list" }).click();
  const dialog = page.getByRole("dialog", { name: `Rename “${from}”` });
  await dialog.getByRole("textbox", { name: "Name" }).fill(to);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1, name: to, exact: true })).toBeVisible();
}

/** Deletes the list whose screen shows, after confirming it; the lists show then. */
async function deleteList(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Delete list" }).click();
  await page
    .getByRole("dialog", { name: `Delete “${name}”?` })
    .getByRole("button", { name: "Delete list" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeFocused();
}

/** Backups go through a worker; an encrypted one takes seconds, as its key takes 256 MiB. */
const DERIVING = { timeout: 30_000 };

/** A backup file that a device saved, and its passphrase if it is encrypted. */
interface Backup {
  readonly name: string;
  readonly contents: Buffer;
  readonly passphrase: string | undefined;
}

async function settings(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Settings" })
    .click();
  // Visible, not focused: the settings may show already, from the last backup.
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
}

/**
 * Makes a plain backup in the settings, and saves it. An encrypted one would add seconds of key
 * derivation to each test that makes one; the encrypted fixture tests that the app reads them.
 */
async function backUp(page: Page): Promise<Backup> {
  await settings(page);
  await page
    .getByRole("region", { name: "Backups" })
    .getByRole("button", { name: "Back up", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Back up your data" })
    .getByRole("button", { name: "Make a plain backup instead" })
    .click();
  await page
    .getByRole("dialog", { name: "A plain backup" })
    .getByRole("button", { name: "Make a plain backup" })
    .click();
  const ready = page.getByRole("dialog", { name: "Your backup is ready" });
  await expect(ready).toBeVisible(DERIVING);
  const download = page.waitForEvent("download");
  await ready.getByRole("button", { name: "Save backup" }).click();
  const file = await download;
  await page
    .getByRole("dialog", { name: "Backed up" })
    .getByRole("button", { name: "Done" })
    .click();
  return {
    name: file.suggestedFilename(),
    contents: await readFile(await file.path()),
    passphrase: undefined,
  };
}

/** Restores a backup in the settings, merging it with what the device has. */
async function restore(page: Page, backup: Backup): Promise<void> {
  await settings(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Restore from a backup" }).click();
  await (
    await chooser
  ).setFiles({
    name: backup.name,
    mimeType: "application/octet-stream",
    buffer: backup.contents,
  });
  if (backup.passphrase !== undefined) {
    const encrypted = page.getByRole("dialog", { name: "This backup is encrypted" });
    await encrypted.getByRole("textbox", { name: "Passphrase" }).fill(backup.passphrase);
    await encrypted.getByRole("button", { name: "Open" }).click();
  }
  const preview = page.getByRole("dialog", { name: "Restore this backup?" });
  await expect(preview).toContainText("Restoring it brings", DERIVING);
  await preview.getByRole("button", { name: "Restore", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Restored" })
    .getByRole("button", { name: "Done" })
    .click();
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the screens and dialogs have no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await open(page);
    await expect(page).toHaveTitle(NAME);
    // The page names and describes the app before any script runs, from app.config.ts.
    const html = await (await page.request.get("/")).text();
    expect(html).toContain(`<title>${escaped(NAME)}</title>`);
    expect(html).toContain(`<meta name="description" content="${escaped(DESCRIPTION)}">`);
    await expect(page.getByRole("main")).toContainText("No lists yet.");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await addList(page, "Groceries");
    await addItem(page, "Milk");
    await addItem(page, "Eggs");
    await tick(page, "Milk");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await edit(page, "Eggs");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Delete list" }).click();
    await expect(page.getByRole("dialog", { name: "Delete “Groceries”?" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");

    await toLists(page);
    await expect(lists(page)).toHaveText(["Groceries 1 of 2 done"]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test("lists are added and opened, sorted by name, with how much of each is done", async ({
  page,
}) => {
  await open(page);
  await addList(page, "Packing");
  await expect(page).toHaveTitle(`Packing – ${NAME}`);
  await expect(page.getByRole("main")).toContainText("No items yet.");
  await toLists(page);

  // Enter adds a list too, without the spaces around its name.
  const field = page.getByRole("textbox", { name: "New list" });
  await field.fill("  Groceries  ");
  await field.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Groceries", exact: true }),
  ).toBeFocused();
  await addItem(page, "Milk");
  await addItem(page, "Eggs");
  await tick(page, "Milk");
  await toLists(page);
  await expect(lists(page)).toHaveText(["Groceries 1 of 2 done", "Packing No items"]);

  await page.reload();
  await expect(lists(page)).toHaveText(["Groceries 1 of 2 done", "Packing No items"]);
  await lists(page).filter({ hasText: "Packing" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Packing", exact: true })).toBeFocused();
});

test("items are ticked off and back, and the focus goes down the list", async ({ page }) => {
  await open(page);
  await addList(page, "Groceries");
  await addItem(page, "Milk");
  await addItem(page, "Eggs");
  // Enter adds an item too, without the spaces around it, and the field is ready for the next.
  const field = page.getByRole("textbox", { name: "New item" });
  await field.fill("  Bread  ");
  await field.press("Enter");
  await expect(texts(page, "To do")).toHaveText(["Milk", "Eggs", "Bread"]);
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(section(page, "Done")).toHaveCount(0);

  // Ticked off with the pointer, an item moves to Done, and the next one takes the focus.
  await label(page, "Milk").click();
  await expect(texts(page, "Done")).toHaveText(["Milk"]);
  await expect(checkbox(page, "Milk")).toBeChecked();
  await expect(checkbox(page, "Eggs")).toBeFocused();
  await expect(status(page)).toHaveText("“Milk” moved to Done.");

  // Space ticks off the item that has the focus; the last one keeps it, among those done.
  await page.keyboard.press("Space");
  await expect(texts(page, "Done")).toHaveText(["Milk", "Eggs"]);
  await expect(checkbox(page, "Bread")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(texts(page, "Done")).toHaveText(["Milk", "Eggs", "Bread"]);
  await expect(checkbox(page, "Bread")).toBeFocused();
  await expect(section(page, "To do")).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Nothing left to do.");

  // Ticked back, an item returns to those to do, and the next one done takes the focus.
  await label(page, "Eggs").click();
  await expect(texts(page, "To do")).toHaveText(["Eggs"]);
  await expect(texts(page, "Done")).toHaveText(["Milk", "Bread"]);
  await expect(checkbox(page, "Eggs")).not.toBeChecked();
  await expect(checkbox(page, "Bread")).toBeFocused();
  await expect(status(page)).toHaveText("“Eggs” moved to To do.");

  await page.reload();
  await expect(texts(page, "To do")).toHaveText(["Eggs"]);
  await expect(texts(page, "Done")).toHaveText(["Milk", "Bread"]);
});

test("an item is renamed and deleted in its dialog, and the focus stays where the user is", async ({
  page,
}) => {
  await open(page);
  await addList(page, "Groceries");
  for (const text of ["Milk", "Eggs", "Bread"]) {
    await addItem(page, text);
  }

  const dialog = await edit(page, "Milk");
  const text = dialog.getByRole("textbox", { name: "Text" });
  await expect(text).toHaveValue("Milk");
  // A blank text is refused, with what to do.
  await text.fill("   ");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Enter the item.")).toBeVisible();
  await text.fill(" Oat milk ");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(texts(page, "To do")).toHaveText(["Oat milk", "Eggs", "Bread"]);
  // The focus is back on the button that opened the dialog.
  await expect(page.getByRole("button", { name: "Edit “Oat milk”" })).toBeFocused();

  // Cancel and Escape change nothing.
  const eggs = await edit(page, "Eggs");
  await eggs.getByRole("textbox", { name: "Text" }).fill("Ham");
  await eggs.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Edit “Eggs”" })).toBeFocused();
  await page.keyboard.press("Enter");
  await eggs.getByRole("textbox", { name: "Text" }).fill("Ham");
  await page.keyboard.press("Escape");
  await expect(eggs).toBeHidden();
  await expect(texts(page, "To do")).toHaveText(["Oat milk", "Eggs", "Bread"]);

  // After a deletion, the focus goes to the next item, else the one before, else the field.
  await deleteItem(page, "Eggs");
  await expect(checkbox(page, "Bread")).toBeFocused();
  await expect(status(page)).toHaveText("“Eggs” deleted.");
  await deleteItem(page, "Bread");
  await expect(checkbox(page, "Oat milk")).toBeFocused();
  await deleteItem(page, "Oat milk");
  await expect(page.getByRole("textbox", { name: "New item" })).toBeFocused();
  await expect(page.getByRole("main")).toContainText("No items yet.");

  await page.reload();
  await expect(page.getByRole("main")).toContainText("No items yet.");
});

test("Clear done items deletes the items that are done, and only those", async ({ page }) => {
  await open(page);
  await addList(page, "Groceries");
  for (const text of ["Milk", "Eggs", "Bread"]) {
    await addItem(page, text);
  }
  await tick(page, "Milk");
  await tick(page, "Bread");
  await page.getByRole("button", { name: "Clear done items" }).click();
  await expect(section(page, "Done")).toHaveCount(0);
  await expect(texts(page, "To do")).toHaveText(["Eggs"]);
  await expect(page.getByRole("textbox", { name: "New item" })).toBeFocused();
  await expect(status(page)).toHaveText("2 done items cleared.");
  await toLists(page);
  await expect(lists(page)).toHaveText(["Groceries 0 of 1 done"]);
});

test("a list is renamed, and deleted with its items once the user confirms", async ({ page }) => {
  await open(page);
  const groceries = await addList(page, "Groceries");
  await addItem(page, "Milk");
  await addItem(page, "Eggs");

  await page.getByRole("button", { name: "Rename list" }).click();
  const rename = page.getByRole("dialog", { name: "Rename “Groceries”" });
  const name = rename.getByRole("textbox", { name: "Name" });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Groceries");
  await name.fill("Food");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Food");
  await expect(page).toHaveTitle(`Food – ${NAME}`);
  await expect(page.getByRole("button", { name: "Rename list" })).toBeFocused();

  // The dialog asks first; Enter deletes nothing, and Cancel keeps the list.
  await page.getByRole("button", { name: "Delete list" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete “Food”?" });
  await expect(confirm).toContainText(
    "The list and its 2 items are deleted. This cannot be undone.",
  );
  await page.keyboard.press("Enter");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Delete list" })).toBeFocused();

  await deleteList(page, "Food");
  await expect(page.getByRole("main")).toContainText("No lists yet.");
  // The deleted list's address says that it is gone.
  await page.goto(`/lists/${groceries}`);
  await expect(page.getByRole("heading", { level: 1, name: "List not found" })).toBeVisible();
  // Its items went with it: a backup has only tombstones.
  const backup = await backUp(page);
  const document: unknown = JSON.parse(backup.contents.toString("utf8"));
  const tombstone = { data: {}, clock: {}, deleted: expect.any(String) };
  expect(document).toMatchObject({
    stores: { lists: [{ id: groceries, ...tombstone }], items: [tombstone, tombstone] },
  });
});

test("a text or a name saved unchanged is not written, as it would win a merge", async ({
  page,
}) => {
  await open(page);
  const groceries = await addList(page, "Groceries");
  await addItem(page, "Milk");
  await backUp(page);
  await page.goto(`/lists/${groceries}`);
  const dialog = await edit(page, "Milk");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Rename list" }).click();
  const rename = page.getByRole("dialog", { name: "Rename “Groceries”" });
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(rename).toBeHidden();
  await settings(page);
  const backups = page.getByRole("region", { name: "Backups" });
  await expect(backups).toContainText("Nothing has changed since then.");
  // A change that changes something is written.
  await page.goto(`/lists/${groceries}`);
  await renameItem(page, "Milk", "Oat milk");
  await settings(page);
  await expect(backups).toContainText("1 change since then.");
});

test("a list that is not on this device says so, with a way to the lists", async ({ page }) => {
  await page.goto("/lists/01a10307-b840-78aa-ab29-1a1138faaff6");
  await expect(page.getByRole("heading", { level: 1, name: "List not found" })).toBeVisible();
  await expect(page).toHaveTitle(`List not found – ${NAME}`);
  await page.getByRole("link", { name: "Go to the lists" }).click();
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeFocused();
});

test("blank names and items are refused, with what to do", async ({ page }) => {
  await open(page);
  const list = page.getByRole("textbox", { name: "New list" });
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Enter the list's name.")).toBeVisible();
  await expect(list).toBeFocused();
  await list.fill("   ");
  await list.press("Enter");
  await expect(page.getByText("Enter the list's name.")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("No lists yet.");
  // The error goes as the user types, not when the pointer goes down on "Add", which would
  // move the button from under it: one click adds.
  await list.fill("Groceries");
  await expect(page.getByText("Enter the list's name.")).toBeHidden();
  await page.getByRole("button", { name: "Add" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Groceries", exact: true }),
  ).toBeFocused();

  const item = page.getByRole("textbox", { name: "New item" });
  await item.fill("  ");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Enter the item.")).toBeVisible();
  await expect(item).toBeFocused();
  await expect(page.getByRole("main")).toContainText("No items yet.");
});

test("a list follows the changes made in another window, up to its deletion", async ({
  page,
  context,
}) => {
  await open(page);
  const groceries = await addList(page, "Groceries");
  await addItem(page, "Milk");

  const other = await context.newPage();
  await other.goto(`/lists/${groceries}`);
  await tick(other, "Milk");
  await expect(texts(page, "Done")).toHaveText(["Milk"]);
  await addItem(other, "Eggs");
  await expect(texts(page, "To do")).toHaveText(["Eggs"]);
  await renameList(other, "Groceries", "Food");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Food");
  await deleteList(other, "Food");
  await expect(page.getByRole("heading", { level: 1, name: "List not found" })).toBeVisible();
});

test("backups merge what two devices changed, as the spec's table says", async ({
  page: a,
  otherDevice: b,
}) => {
  // Device A makes the lists, and device B restores them from A's backup. The device in use is
  // in front, where the focus is.
  await open(a);
  const groceries = await addList(a, "Groceries");
  for (const text of ["Milk", "Eggs", "Apples", "Pears"]) {
    await addItem(a, text);
  }
  await toLists(a);
  const party = await addList(a, "Party");
  await toLists(a);
  const camping = await addList(a, "Camping");
  const first = await backUp(a);
  await b.bringToFront();
  await open(b);
  await restore(b, first);

  // Each row of docs/specs/apps/checklists.md §3, in the order that it needs.
  await b.goto(`/lists/${groceries}`);
  await tick(b, "Apples"); // Row 4: B ticks an item before A deletes it.

  await a.bringToFront();
  await a.goto(`/lists/${groceries}`);
  await tick(a, "Milk"); // Row 1: A ticks an item, which B renames.
  await tick(a, "Eggs"); // Row 2: A ticks an item, which B ticks and unticks later.
  await addItem(a, "Bread"); // Row 3: A adds an item, and B another.
  await deleteItem(a, "Apples"); // Row 4.
  await deleteItem(a, "Pears"); // Row 5: A deletes an item, which B ticks later.
  await a.goto(`/lists/${party}`);
  await deleteList(a, "Party"); // Row 6: A deletes a list, to which B adds an item.
  await a.goto(`/lists/${camping}`);
  await deleteList(a, "Camping"); // Row 7: A deletes a list, which B renames later.
  const fromA = await backUp(a);

  await b.bringToFront();
  await renameItem(b, "Milk", "Oat milk"); // Row 1.
  await tick(b, "Eggs"); // Row 2.
  await tick(b, "Eggs");
  await addItem(b, "Butter"); // Row 3.
  await tick(b, "Pears"); // Row 5.
  await b.goto(`/lists/${party}`);
  await addItem(b, "Cake"); // Row 6.
  await b.goto(`/lists/${camping}`);
  await renameList(b, "Camping", "Hiking"); // Row 7.

  // Each device restores the other's backup.
  await restore(b, fromA);
  const merged = await backUp(b);
  await a.bringToFront();
  await restore(a, merged);

  for (const device of [a, b]) {
    await device.bringToFront();
    await open(device);
    await expect(lists(device)).toHaveText(["Groceries 1 of 4 done", "Hiking No items"]);
    await lists(device).filter({ hasText: "Groceries" }).click();
    await expect(texts(device, "To do")).toHaveText(["Eggs", "Bread", "Butter"]);
    await expect(texts(device, "Done")).toHaveText(["Oat milk"]);
    await device.goto(`/lists/${party}`);
    await expect(device.getByRole("heading", { level: 1, name: "List not found" })).toBeVisible();
  }

  // What no screen shows is kept (spec §3): the item added to the deleted list, and the tick
  // that came back alone, without the item's text and list, which the deletion erased.
  const document: unknown = JSON.parse(merged.contents.toString("utf8"));
  expect(document).toMatchObject({
    stores: {
      lists: expect.arrayContaining([
        { id: party, v: 1, data: {}, clock: {}, deleted: expect.any(String) },
        expect.objectContaining({ id: camping, data: { name: "Hiking" } }),
      ]),
      items: expect.arrayContaining([
        expect.objectContaining({ data: { list: party, text: "Cake" } }),
        expect.objectContaining({ data: { done: true }, deleted: expect.any(String) }),
      ]),
    },
  });
});

/**
 * Backups that the app made of each schema version, which every later version must restore
 * (backup format §8). They are never changed: a change that breaks one would break restoring
 * the users' own backups.
 */
const FIXTURES = [
  { file: "format-1-schema-1.json", passphrase: undefined },
  { file: "format-1-schema-1.age", passphrase: "checklists fixture 1" },
] as const;

for (const { file, passphrase } of FIXTURES) {
  test(`the backup ${file}, of schema version 1, restores as it was made`, async ({ page }) => {
    await open(page);
    const contents = await readFile(new URL(`fixtures/${file}`, import.meta.url));
    await restore(page, { name: file, contents, passphrase });
    await toLists(page);
    await expect(lists(page)).toHaveText(["Groceries 1 of 3 done", "Packing 0 of 1 done"]);
    await lists(page).filter({ hasText: "Groceries" }).click();
    await expect(texts(page, "To do")).toHaveText(["Eggs", "Bread"]);
    await expect(texts(page, "Done")).toHaveText(["Milk"]);
    await toLists(page);
    await lists(page).filter({ hasText: "Packing" }).click();
    await expect(texts(page, "To do")).toHaveText(["Charger"]);
  });
}

test("the settings have every part that every app has", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page).toHaveTitle(`Settings – ${NAME}`);
  for (const name of ["Install", "Storage", "Backups", `About ${NAME}`]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: `About ${NAME}` })).toContainText(DESCRIPTION);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("says where to report a security problem, at /.well-known/security.txt", async ({
  request,
}) => {
  const response = await request.get("/.well-known/security.txt");
  expect(response.status()).toBe(200);
  // RFC 9116 asks for UTF-8 plain text.
  expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toMatch(
    /^Contact: https:\/\/github\.com\/shkriuss\/shkriuss\.app\/security\/advisories\/new$/m,
  );
});

test("the app's service worker controls it and keeps every file of the build, for offline", async ({
  page,
}) => {
  await open(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const missing = await page.evaluate(async () => {
    const sums = await (await fetch("/sha256sums.txt")).text();
    const files = sums
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/)[1] ?? "")
      // security.txt changes with every commit, so it is not kept: it would make each a version.
      .filter((file) => file !== "/sw.js" && file !== "/.well-known/security.txt");
    const kept = await Promise.all(
      files.map(
        async (file) => (await caches.match(file === "/index.html" ? "/" : file)) !== undefined,
      ),
    );
    return files.filter((_file, index) => kept[index] !== true);
  });
  expect(missing).toStrictEqual([]);
});

test("it works offline after the first visit, with its lists", async ({ page, network }) => {
  await open(page, network.url);
  await addList(page, "Groceries");
  await addItem(page, "Milk");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  network.cut();
  // The list's own address opens offline, with its items, and changes are kept.
  await page.reload();
  await expect(texts(page, "To do")).toHaveText(["Milk"]);
  await addItem(page, "Eggs");
  await tick(page, "Milk");
  await page.reload();
  await expect(texts(page, "To do")).toHaveText(["Eggs"]);
  await expect(texts(page, "Done")).toHaveText(["Milk"]);
  await toLists(page);
  await expect(lists(page)).toHaveCount(1);
});

test("a newer version of the app in another window closes the data here, and the app says so", async ({
  page,
}) => {
  await open(page);
  // Once the service worker is ready, nothing else changes the update banner.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // What a newer version of the app does when it opens the database: it upgrades it.
  await page.evaluate(
    async () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("shkriuss", 1000);
        request.addEventListener("success", () => {
          request.result.close();
          resolve();
        });
        request.addEventListener("error", () => {
          reject(new Error("The test could not upgrade the database."));
        });
      }),
  );
  const banner = page.getByRole("status");
  await expect(banner).toContainText("The app was updated in another window.");
  const loaded = page.waitForEvent("load");
  await banner.getByRole("button", { name: "Reload" }).click();
  await loaded;
  // This build is older than the database now: it opens nothing, and says why.
  await expect(page.getByRole("heading", { level: 1, name: "This app was updated" })).toBeVisible();
  await expect(page).toHaveTitle(`This app was updated – ${NAME}`);
  await expect(page.getByRole("main")).toContainText("Reload the app to use it.");
});

test("an address that the app does not have says so, in the frame", async ({ page }) => {
  await page.goto("/nowhere");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: `Go to ${NAME}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeFocused();
});
