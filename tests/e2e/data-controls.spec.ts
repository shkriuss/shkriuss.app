// "Your data" (backup, restore, delete) in every app that saves data.
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from './fixtures.ts';

const PASSPHRASE = 'four random words here';
const SAMPLE = { v: 1, data: { note: 'private sample text' } };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  test.skip((await page.locator('[data-data-controls]').count()) === 0, 'This site saves no data.');
  test.skip(
    await page.locator('[data-data-controls] [data-action="backup"]').isHidden(),
    'This site’s data is too big for backups.',
  );
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
  await expect(page.getByRole('status').filter({ hasText: 'without a passphrase' })).toBeVisible();

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

test('a backup that can’t be restored changes nothing, sync history included', async ({ page }) => {
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
