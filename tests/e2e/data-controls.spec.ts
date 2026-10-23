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
  await checkA11y(page, 'restore dialog');
  const unlock = restoreDialog(page).getByLabel('Passphrase');
  await unlock.fill('not the right passphrase');
  await restoreDialog(page).getByRole('button', { name: 'Restore' }).click();
  await expect(unlock).toHaveAccessibleDescription(/doesn’t unlock this backup/);

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
  const reloaded = page.waitForEvent('load');
  await restoreDialog(page).getByRole('button', { name: 'Restore' }).click();
  await reloaded;
  expect(await saved(page)).toEqual({ sample: JSON.stringify(SAMPLE), theme: 'dark' });
});

test('turns down files that aren’t this app’s backups', async ({ page }) => {
  const other = { app: 'some-other-app', exportedAt: new Date().toISOString(), data: {} };
  await chooseBackup(page, { name: 'other.json', buffer: Buffer.from(JSON.stringify(other)) });
  await expect(restoreDialog(page)).toContainText('This backup is from a different app');
  await expect(restoreDialog(page).getByRole('button', { name: 'Restore' })).toBeHidden();
  await restoreDialog(page).getByRole('button', { name: 'Close' }).click();

  await chooseBackup(page, { name: 'notes.json', buffer: Buffer.from('{"hello":"world"}') });
  await expect(restoreDialog(page)).toContainText('This file isn’t a backup from shkriuss.app.');
  await restoreDialog(page).getByRole('button', { name: 'Close' }).click();
  expect((await saved(page)).sample).toBe(JSON.stringify(SAMPLE));
});
