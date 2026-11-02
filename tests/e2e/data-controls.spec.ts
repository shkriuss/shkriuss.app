// "Your data" (backup, restore, delete) in every app that saves data.
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { getSite } from '../../packages/registry/src/index.ts';
import { forThisSite, type EverySite } from './every-site.ts';
import { checkA11y, expect, test } from './fixtures.ts';

const PASSPHRASE = 'four random words here';
const SAMPLE = { v: 1, data: { note: 'private sample text' } };

/**
 * Sites whose data is too big for backup files: their "Your data" has no
 * "Back up" or "Restore" (DataControls backup={false}).
 */
const NO_BACKUPS: readonly string[] = ['photos'];

test.beforeEach(async ({ page }, testInfo) => {
  // From the registry, never from the page: if "Your data" went missing from
  // an app that saves data, or a part of it was renamed, these tests would
  // skip, and CI stay green (audit 4 J-2). Now they fail.
  const site = getSite(testInfo.project.name);
  test.skip(site.kind === 'hub' || site.storage === 'none', 'This site saves no app data.');
  await page.goto('/');
  await page.evaluate((sample) => {
    localStorage.setItem('shkriuss:e2e-sample', JSON.stringify(sample));
    localStorage.setItem('shkriuss:theme', 'dark');
  }, SAMPLE);
});

const backupDialog = (page: Page) => page.getByRole('dialog', { name: 'Back up your data' });
const restoreDialog = (page: Page) => page.getByRole('dialog', { name: 'Restore a backup' });

async function chooseBackup(page: Page, file: string | { name: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore' }).click();
  const picker = await chooser;
  if (typeof file === 'string') await picker.setFiles(file);
  else await picker.setFiles({ ...file, mimeType: 'application/json' });
}

const saved = (page: Page) =>
  page.evaluate(() => ({
    sample: localStorage.getItem('shkriuss:e2e-sample'),
    theme: localStorage.getItem('shkriuss:theme'),
  }));

test('an app that saves data shows “Your data”', async ({ page }, testInfo) => {
  // CLAUDE.md: apps that store data show <DataControls />.
  const controls = page.getByRole('region', { name: 'Your data' });
  await expect(controls).toBeVisible();
  const backups = !NO_BACKUPS.includes(testInfo.project.name);
  for (const name of ['Back up', 'Restore']) {
    await expect(controls.getByRole('button', { name })).toBeVisible({ visible: backups });
  }
  await expect(controls.getByRole('button', { name: 'Delete all data' })).toBeVisible();
});

test('says when the browser deletes it all by itself, and how to keep it (audit 6 E-5, Z-1)', async ({
  page,
}, testInfo) => {
  const { name, sync } = getSite(testInfo.project.name);
  const backups = !NO_BACKUPS.includes(testInfo.project.name);
  const controls = page.getByRole('region', { name: 'Your data' });
  const safari = controls.getByText(/^Safari deletes a website’s data when it isn’t opened/);
  await expect(safari).toBeVisible();
  // Following "add it to your Home Screen" alone left everything in Safari:
  // on an iPhone, the app there has its own storage.
  await expect(safari).toContainText(
    `On an iPhone or iPad, ${name} on the Home Screen keeps its own data, apart from Safari’s, so it starts empty: `,
  );
  await expect(safari).toContainText(
    [
      ...(backups ? ['back up here and restore it there'] : []),
      ...(sync ? ['turn on sync in both'] : []),
    ].join(', or ') + '.',
  );
  // Saving works in a private window, so nothing else warns that closing it
  // deletes everything.
  await expect(controls.getByText(/^In a private window/)).toHaveText(
    `In a private window, everything is deleted when you close it: ${[
      ...(backups ? ['back up'] : []),
      ...(sync ? ['turn on sync'] : []),
    ].join(' or ')} before you do.`,
  );
});

test('“Delete all data” also forgets what this device kept for itself (audit 5 D-1)', async ({
  page,
}) => {
  // What sync and reminders keep on this device under keys backups leave
  // out: the sync state after sync was turned off, its file lists, and the
  // apps' shared last reminder check, which "Delete all data" left behind.
  await page.evaluate(() => {
    localStorage.setItem(
      'shkriuss-device:sync',
      JSON.stringify({
        secret: null,
        code: null,
        remote: null,
        known: {},
        dirty: false,
        base: null,
        last: 1_700_000_000_000,
        serverTime: null,
        connected: null,
        previous: [],
        waiting: {},
      }),
    );
    localStorage.setItem(
      'shkriuss-device:sync-files',
      '{"uploads":[],"removals":[],"checked":null}',
    );
    localStorage.setItem(
      'shkriuss-device:reminders-checked',
      JSON.stringify({ stamp: '2026-10-27T09:41', at: Date.now() }),
    );
  });
  await page.getByRole('button', { name: 'Delete all data' }).click();
  const reloaded = page.waitForEvent('load', { timeout: 10_000 });
  await page
    .getByRole('dialog', { name: 'Delete all data?' })
    .getByRole('button', { name: 'Delete everything' })
    .click();
  await reloaded;
  const left = await page.evaluate(() => ({
    sample: localStorage.getItem('shkriuss:e2e-sample'),
    // The app's own stores may be written again as it starts (Calendar notes
    // when it checked its reminders); what it kept for this device may not.
    device: Object.keys(localStorage)
      .filter((key) => key.startsWith('shkriuss-device:'))
      .sort(),
  }));
  expect(left.sample).toBeNull();
  // Only a note that the notification server still has this device's
  // reminders to delete may stay, when it couldn't be reached (not here).
  expect(left.device.filter((key) => key !== 'shkriuss-device:push-delete')).toEqual([]);
});

test('the dialogs that delete read out what they will delete (audit 5 G-3)', async ({
  page,
}, testInfo) => {
  // A screen reader says a dialog's name and its description as it opens,
  // then the focused button: without the description it heard "Delete all
  // data? dialog, Cancel, button" and had to read on.
  await page.getByRole('button', { name: 'Delete all data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete all data?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog).toHaveAccessibleDescription(
    /^This removes everything .+ has saved on this device\. It can’t be undone\./,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  if (!getSite(testInfo.project.name).sync) return;
  // "Delete the online copy?" shows only with sync on: its wording is checked
  // without an account, opened the way the sync script opens it.
  await page.evaluate(() => {
    document.querySelector<HTMLDialogElement>('[data-sync-delete-dialog]')?.showModal();
  });
  const online = page.getByRole('dialog', { name: 'Delete the online copy?' });
  await expect(online).toBeVisible();
  const text = ((await online.locator('form > p').first().textContent()) ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  expect(text).toMatch(/^This deletes /);
  await expect(online).toHaveAccessibleDescription(text);
  await page.keyboard.press('Escape');
  await expect(online).toBeHidden();
});

/**
 * Each site's main store, for the test below: named after the app, or null
 * where there's none. A new app saves nothing but its theme until it's
 * built, so the generator gives it null (audit 6 J-1: the test failed for
 * every new app). Every site has a line (every-site.ts).
 */
const mainStores: EverySite<string> = {
  budget: 'shkriuss:budget',
  calendar: 'shkriuss:calendar',
  grammar: 'shkriuss:grammar',
  habits: 'shkriuss:habits',
  // No app data (the beforeEach above skips it).
  hub: null,
  meals: 'shkriuss:meals',
  notes: 'shkriuss:notes',
  // Its photos are in the files database; this storage has a count of its changes.
  photos: 'shkriuss:photos-changes',
  reminders: 'shkriuss:reminders',
  repairs: 'shkriuss:repairs',
  shelf: 'shkriuss:shelf',
  tally: 'shkriuss:tally',
  tasks: 'shkriuss:tasks',
  trades: 'shkriuss:trades',
  water: 'shkriuss:water',
};

test('says when what’s saved is from a newer version of the app, and Restore leaves it alone (audit 5 E-3)', async ({
  page,
}, testInfo) => {
  const slug = testInfo.project.name;
  const key = forThisSite(mainStores);
  test.skip(!key, 'This site has no store of its own yet.');
  if (!key) return;
  // Saved by a version far ahead of this one: after a rollback, or in a tab
  // open from before an update. The app showed nothing, with no word.
  const newer = JSON.stringify({ v: 1_000_000, data: {} });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: newer });
  await page.reload();
  const problem = page.locator('[data-problem]').getByRole('alert');
  await expect(problem).toHaveText(/saved by a newer version of this app/);
  await checkA11y(page, 'newer data notice');

  if (NO_BACKUPS.includes(slug)) return;
  // Restoring a backup this version can read would delete the newer data: refused.
  const copy = {
    app: slug,
    exportedAt: new Date().toISOString(),
    data: { 'shkriuss:e2e-sample': SAMPLE },
  };
  await chooseBackup(page, { name: 'copy.json', buffer: Buffer.from(JSON.stringify(copy)) });
  await restoreDialog(page).getByRole('button', { name: 'Restore' }).click();
  await expect(restoreDialog(page)).toContainText(/newer version of this app.*Nothing was changed/);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(newer);
});

test.describe('backing up and restoring', () => {
  test.beforeEach(({ page: _ }, testInfo) => {
    test.skip(
      NO_BACKUPS.includes(testInfo.project.name),
      'This site’s data is too big for backups.',
    );
  });

  test('a locked backup restores everything, only with its passphrase', async ({ page }) => {
    await page.getByRole('button', { name: 'Back up' }).click();
    const dialog = backupDialog(page);
    const passphrase = dialog.getByLabel('Passphrase', { exact: true });
    const again = dialog.getByLabel('Type it again');

    // Explains problems.
    await passphrase.fill('too short');
    await dialog.getByRole('button', { name: 'Download backup' }).click();
    await expect(passphrase).toHaveAccessibleDescription(/Use at least 12 characters\./);
    await expect(passphrase).toBeFocused();
    await passphrase.fill(PASSPHRASE);
    await again.fill('something else entirely');
    await dialog.getByRole('button', { name: 'Download backup' }).click();
    await expect(again).toHaveAccessibleDescription('The two passphrases don’t match.');
    // Enter in the field: focus is there already, so the problem is read out (audit G-3).
    await again.press('Enter');
    await expect(dialog.getByRole('alert')).toHaveText(
      'Type it again: The two passphrases don’t match.',
    );
    await checkA11y(page, 'backup dialog with problems');

    await dialog.getByLabel('Show passphrase').check();
    await expect(passphrase).toHaveAttribute('type', 'text');
    // Text fields now: no spell-checker (some send what's typed to a server),
    // no autocorrection or capitals, which Restore wouldn't repeat (audit 7
    // A-3, run 27).
    for (const field of [passphrase, again]) {
      await expect(field).toHaveAttribute('spellcheck', 'false');
      await expect(field).toHaveAttribute('autocorrect', 'off');
      await expect(field).toHaveAttribute('autocapitalize', 'off');
    }
    await again.fill(PASSPHRASE);
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download backup' }).click();
    const file = await (await download).path();
    await expect(dialog).toBeHidden();
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text)).toMatchObject({ format: 'shkriuss-backup', version: 1 });
    expect(text).not.toContain('private sample text');

    // Change the data, then restore.
    await page.evaluate(() => {
      localStorage.setItem('shkriuss:e2e-sample', '{"v":1,"data":{"note":"changed"}}');
      localStorage.removeItem('shkriuss:theme');
    });
    await chooseBackup(page, file);
    await expect(restoreDialog(page)).toContainText('locked with a passphrase');
    await expect(restoreDialog(page)).toContainText('Restoring replaces everything');
    // Read out as it opens, with its warning (audit G-9).
    await expect(restoreDialog(page)).toHaveAccessibleDescription(
      /^This backup is from .+ and is locked with a passphrase\. Restoring replaces everything/,
    );
    await checkA11y(page, 'restore dialog');
    const unlock = restoreDialog(page).getByLabel('Passphrase');
    await expect(unlock).toBeFocused();
    await expect(unlock).toHaveAttribute('spellcheck', 'false');
    await expect(unlock).toHaveAttribute('autocorrect', 'off');
    await unlock.fill('not the right passphrase');
    await restoreDialog(page).getByRole('button', { name: 'Restore' }).click();
    await expect(unlock).toHaveAccessibleDescription(/doesn’t unlock this backup/);
    // Enter in the field: focus is there already, so the problem is read out (audit 3 G-4).
    await unlock.fill('');
    await unlock.press('Enter');
    await expect(restoreDialog(page).getByRole('alert')).toHaveText(
      'Passphrase: Enter the passphrase for this backup.',
    );
    await unlock.fill('still not the right passphrase');
    await unlock.press('Enter');
    await expect(restoreDialog(page).getByRole('alert')).toHaveText(
      'Passphrase: That passphrase doesn’t unlock this backup. Check it and try again.',
    );

    await unlock.fill(PASSPHRASE);
    // Restoring reloads the page.
    const reloaded = page.waitForEvent('load');
    await restoreDialog(page).getByRole('button', { name: 'Restore' }).click();
    await reloaded;
    expect(await saved(page)).toEqual({ sample: JSON.stringify(SAMPLE), theme: 'dark' });
  });

  test('a plain copy restores without a passphrase', async ({ page }) => {
    await page.getByRole('button', { name: 'Back up' }).click();
    const download = page.waitForEvent('download');
    await backupDialog(page).getByRole('button', { name: 'Download without a passphrase' }).click();
    const file = await (await download).path();
    expect(await readFile(file, 'utf8')).toContain('private sample text');
    await expect(
      page.getByRole('status').filter({ hasText: 'without a passphrase' }),
    ).toBeVisible();

    await page.evaluate(() => localStorage.removeItem('shkriuss:e2e-sample'));
    await chooseBackup(page, file);
    await expect(restoreDialog(page).getByLabel('Passphrase')).toBeHidden();
    // Focus starts on "Cancel": one press of Enter mustn't replace everything.
    await expect(restoreDialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(restoreDialog(page)).toBeHidden();
    expect((await saved(page)).sample).toBeNull();

    await chooseBackup(page, file);
    const reloaded = page.waitForEvent('load');
    await restoreDialog(page).getByRole('button', { name: 'Restore' }).click();
    await reloaded;
    expect(await saved(page)).toEqual({ sample: JSON.stringify(SAMPLE), theme: 'dark' });
  });

  test('keeps focus on “Download backup” while it locks, and after a problem', async ({ page }) => {
    await page.getByRole('button', { name: 'Back up' }).click();
    const dialog = backupDialog(page);
    await dialog.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
    await dialog.getByLabel('Type it again').fill(PASSPHRASE);
    // Locking the backup will fail, when the test says so.
    await page.evaluate(() => {
      const target = window as unknown as { locks: number; failLocking: () => void };
      target.locks = 0;
      crypto.subtle.deriveKey = () =>
        new Promise((_, reject) => {
          target.locks += 1;
          target.failLocking = () => {
            reject(new Error('Locking failed'));
          };
        });
    });
    const locks = () => page.evaluate(() => (window as unknown as { locks: number }).locks);
    const button = dialog.getByRole('button', { name: 'Download backup' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('status')).toHaveText('Locking your backup…');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toBeFocused();
    await checkA11y(page, 'backup dialog while locking');
    // Pressing it again meanwhile does nothing, nor does Enter in a field.
    await page.keyboard.press('Enter');
    await dialog.getByLabel('Type it again').press('Enter');
    expect(await locks()).toBe(1);

    await button.focus();
    await page.evaluate(() => {
      (window as unknown as { failLocking: () => void }).failLocking();
    });
    await expect(dialog.getByRole('status')).toHaveText(
      'Something went wrong while locking the backup. Please try again.',
    );
    await expect(button).not.toHaveAttribute('aria-disabled');
    await expect(button).toBeFocused();
    await checkA11y(page, 'backup dialog after a problem');
  });

  test('a backup that can’t be restored changes nothing, sync history included', async ({
    page,
  }) => {
    // What this device knew at its last sync, kept while sync is off: a refused
    // restore keeps it too, as it says (audit 4 E-2).
    const syncState = JSON.stringify({
      secret: null,
      code: null,
      remote: null,
      known: {},
      dirty: false,
      base: null,
      last: 1_700_000_000_000,
      serverTime: null,
      connected: null,
      previous: [],
      waiting: {},
    });
    await page.evaluate((state) => localStorage.setItem('shkriuss-device:sync', state), syncState);
    await page.getByRole('button', { name: 'Back up' }).click();
    const download = page.waitForEvent('download');
    await backupDialog(page).getByRole('button', { name: 'Download without a passphrase' }).click();
    const backup = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
      data: Record<string, unknown>;
    };
    // Nested deeper than any app's data: refused as unreadable (audit 3 C-1).
    let deep: unknown = 'deep';
    for (let level = 0; level < 100; level += 1) deep = { deeper: deep };
    backup.data['shkriuss:e2e-sample'] = deep;

    await chooseBackup(page, { name: 'backup.json', buffer: Buffer.from(JSON.stringify(backup)) });
    await restoreDialog(page).getByRole('button', { name: 'Restore' }).click();
    await expect(restoreDialog(page)).toContainText('Nothing was changed.');
    expect(await page.evaluate(() => localStorage.getItem('shkriuss-device:sync'))).toBe(syncState);
    expect((await saved(page)).sample).toBe(JSON.stringify(SAMPLE));
  });

  test('turns down files that aren’t this app’s backups', async ({ page }) => {
    const other = { app: 'some-other-app', exportedAt: new Date().toISOString(), data: {} };
    await chooseBackup(page, { name: 'other.json', buffer: Buffer.from(JSON.stringify(other)) });
    await expect(restoreDialog(page)).toContainText('This backup is from a different app');
    await expect(restoreDialog(page).getByRole('button', { name: 'Restore' })).toBeHidden();
    await expect(restoreDialog(page).getByRole('button', { name: 'Close' })).toBeFocused();
    await restoreDialog(page).getByRole('button', { name: 'Close' }).click();

    await chooseBackup(page, { name: 'notes.json', buffer: Buffer.from('{"hello":"world"}') });
    await expect(restoreDialog(page)).toContainText('This file isn’t a backup from shkriuss.app.');
    // Why, read out as it opens, not only "Close" (audit G-9).
    await expect(restoreDialog(page)).toHaveAccessibleDescription(
      'This file isn’t a backup from shkriuss.app.',
    );
    await restoreDialog(page).getByRole('button', { name: 'Close' }).click();
    expect((await saved(page)).sample).toBe(JSON.stringify(SAMPLE));
  });
});
