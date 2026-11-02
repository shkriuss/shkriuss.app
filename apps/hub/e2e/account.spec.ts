// The optional shkriuss account (packages/account, docs/adr/0010): creating
// one, the recovery key, adding a device with a one-time code, passkeys, and
// what the account service accepts.
import { randomBytes, webcrypto } from 'node:crypto';
import type { Browser, BrowserContext, CDPSession, Download, Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { sites } from '../../../tests/e2e/sites.ts';
import { apps, hub } from '../../../packages/registry/src/index.ts';

const RECOVERY_KEY = /^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/;
const ACCOUNT_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const syncApps = apps.filter((app) => app.sync === true && app.status !== 'hidden');
const view = (page: Page, name: string) => page.locator(`[data-view="${name}"]`);
const accountCode = (page: Page) => page.locator('[data-account-code]');
const message = (page: Page) => page.locator('[data-message]');

/** Creates an account in the page; returns its recovery key and account code. */
async function createAccount(page: Page): Promise<{ key: string; code: string }> {
  await page.goto('/account/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  const key = (await page.locator('[data-new-key]').textContent()) ?? '';
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(view(page, 'signed-in')).toBeVisible();
  return { key, code: (await accountCode(page).textContent()) ?? '' };
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out of this device' }).click();
  await page
    .getByRole('dialog', { name: 'Sign out of this device?' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(view(page, 'signed-out')).toBeVisible();
}

/** A second device: its own browser storage, same site. */
async function otherDevice(browser: Browser, baseURL: string | undefined): Promise<BrowserContext> {
  return browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    locale: 'en-US',
    serviceWorkers: 'block',
  });
}

/** What a downloaded file holds, as text. */
async function downloadedText(file: Download): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

test('creates an account once the recovery key is saved', async ({ page }) => {
  await page.goto('/account/');
  await expect(view(page, 'signed-out')).toBeVisible();
  await checkA11y(page, 'account: signed out');

  await page.getByRole('button', { name: 'Create an account' }).click();
  const key = (await page.locator('[data-new-key]').textContent()) ?? '';
  expect(key).toMatch(RECOVERY_KEY);
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  // Safari there saves downloads to iCloud Drive by default (audit 6 D-4).
  await expect(view(page, 'new')).toContainText(
    'On an iPhone or iPad, a download usually goes to iCloud Drive',
  );
  await checkA11y(page, 'account: save the recovery key');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recovery key' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('shkriuss-recovery-key.txt');
  const text = await downloadedText(file);
  expect(text).toContain(key);

  // Nothing is saved until the person confirms.
  expect(await page.evaluate(() => localStorage.getItem('shkriuss-device:account'))).toBeNull();
  await page.getByLabel("I've saved my recovery key").check();
  await continueButton.click();
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect(message(page)).toHaveText('Your account is ready, and this device is signed in.');
  const code = (await accountCode(page).textContent()) ?? '';
  expect(code).toMatch(ACCOUNT_CODE);
  expect(text).toContain(`Account code: ${code}`);
  await checkA11y(page, 'account: signed in');
  // A sentence shown only when some app needs it keeps its space before it.
  expect(await view(page, 'signed-in').innerText()).not.toMatch(/[a-z)’”]\.[A-Z“]/);

  // Still signed in after a reload, and the key can be seen again.
  await page.reload();
  await expect(accountCode(page)).toHaveText(code);
  await page.getByRole('button', { name: 'Show recovery key' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Your recovery key' }).locator('[data-dialog-key]'),
  ).toHaveText(key);
});

test('signs in with the recovery key, forgiving spaces and case, catching typos', async ({
  page,
}) => {
  const { key, code } = await createAccount(page);
  await signOut(page);
  expect(await page.evaluate(() => localStorage.getItem('shkriuss-device:account'))).toBeNull();

  await page.getByRole('button', { name: 'Use my recovery key' }).click();
  const input = page.getByRole('textbox', { name: 'Recovery key' });
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  const error = page.locator('#recovery-key-error');
  // Typed as it is, and kept from spell-checkers (audit 7 A-3, run 27).
  await expect(input).toHaveAttribute('spellcheck', 'false');
  await expect(input).toHaveAttribute('autocorrect', 'off');

  await input.fill('not a key');
  await signIn.click();
  await expect(error).toHaveText(/isn’t a recovery key/);
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  const typo = key.replace(/^./, key.startsWith('A') ? 'B' : 'A');
  await input.fill(typo);
  await signIn.click();
  await expect(error).toHaveText(/There’s a mistake/);
  await checkA11y(page, 'account: recovery key with a mistake');

  // While the account service is asked whether the key was replaced, the
  // page says so, and a second press does nothing (audit 4 G-6).
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  const asked: string[] = [];
  await page.route('**/api/account/status', async (route) => {
    asked.push(route.request().method());
    await answered;
    await route.fallback();
  });
  await input.fill(` ${key.toLowerCase().replace(/-/g, ' ')} `);
  await signIn.click();
  await expect(message(page)).toHaveText('Signing in…');
  await expect(signIn).toHaveAttribute('aria-disabled', 'true');
  await signIn.click({ force: true });
  answer();
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect(accountCode(page)).toHaveText(code);
  await expect(message(page)).toHaveText('Signed in with your recovery key.');
  expect(asked).toEqual(['GET']);
});

test('adds another device with a one-time code', async ({ page, browser, baseURL, guard }) => {
  const { key, code } = await createAccount(page);
  const secret = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('shkriuss-device:account') ?? '{}') as { secret: string })
        .secret,
  );

  const upload = page.waitForRequest(
    (request) => request.url().includes('/api/account/link/') && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Show a code' }).click();
  await expect(page.getByRole('img', { name: /QR code to add another device/ })).toBeVisible();
  const url = (await page.locator('[data-link-url]').textContent()) ?? '';
  expect(url).toMatch(/\/account\/#link=[\w-]{22}\.[\w-]{43}$/);
  await expect(page.locator('[data-link-status]')).toHaveText(/Waiting for your other device/);
  await checkA11y(page, 'account: showing a code');

  // The server gets the secret sealed, never the secret, the key or the link's key.
  const body = (await upload).postData() ?? '';
  const linkKey = url.split('.').at(-1) ?? '';
  for (const secretPart of [secret, key, key.replace(/-/g, ''), linkKey]) {
    expect(body).not.toContain(secretPart);
  }

  // The other device opens the link (what scanning the QR code does).
  const other = await otherDevice(browser, baseURL);
  const second = await other.newPage();
  const sent: string[] = [];
  second.on('request', (request) => sent.push(request.url()));
  await second.goto(url);
  await expect(view(second, 'link-confirm')).toBeVisible();
  await expect(second.locator('[data-link-code]')).toHaveText(code);
  expect(second.url(), 'the key is taken out of the address bar').not.toContain('#');
  for (const address of sent) expect(address).not.toContain(linkKey);
  // "Add this device" works a moment after the question shows (audit 4 C-6):
  // checked once it does, and its colours have finished changing.
  const add = second.getByRole('button', { name: 'Add this device' });
  await expect(add).not.toHaveAttribute('aria-disabled');
  await add.evaluate((button) =>
    Promise.all(button.getAnimations().map((animation) => animation.finished)),
  );
  await checkA11y(second, 'account: confirm a linked device');
  await add.click();
  await expect(view(second, 'signed-in')).toBeVisible();
  await expect(accountCode(second)).toHaveText(code);

  // Opened, not "signed in": its person may still tap Cancel (audit 7 A-6, run 27).
  await expect(page.locator('[data-link-status]')).toHaveText(
    'A device opened this code, so it can sign in to your account. If it wasn’t one of yours, replace your account key now (below).',
  );
  await expect(page.locator('[data-link-qr] svg')).toHaveCount(0);

  // A code works once.
  guard.allowConsole('Failed to load resource: the server responded with a status of 410 (Gone)');
  const third = await (await otherDevice(browser, baseURL)).newPage();
  await third.goto(url);
  // Used by someone else first: the person is told, and what to do.
  await expect(message(third)).toHaveText(/^Someone already used this code\. If it wasn’t you/);
  await expect(view(third, 'signed-out')).toBeVisible();
  await other.close();
});

test('“Add this device” works only a moment after its question is on screen', async ({
  page,
  browser,
  baseURL,
}) => {
  // A press sooner may be the second click of a double-click another website
  // asked for, closing its own window over this one in between (audit 4 C-6).
  await createAccount(page);
  await page.getByRole('button', { name: 'Show a code' }).click();
  await expect(page.locator('[data-link-status]')).toHaveText(/Waiting for your other device/);
  const url = (await page.locator('[data-link-url]').textContent()) ?? '';
  const other = await otherDevice(browser, baseURL);
  const second = await other.newPage();
  // Paused: no timer fires but those the test runs.
  await second.clock.install({ time: new Date('2026-10-26T12:00:00') });
  await second.clock.pauseAt(new Date('2026-10-26T12:00:01'));
  await second.goto(url);
  await expect(view(second, 'link-confirm')).toBeVisible();
  const add = second.getByRole('button', { name: 'Add this device' });
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  // A press meanwhile does nothing.
  await add.focus();
  await second.keyboard.press('Enter');
  await second.clock.runFor(400);
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await expect(view(second, 'link-confirm')).toBeVisible();
  await second.clock.runFor(100);
  await expect(add).not.toHaveAttribute('aria-disabled');
  // Away from the window and back: another half second, and keyboard focus
  // is still on the button (it's marked busy, not disabled).
  await second.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await second.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(add).toBeFocused();
  await second.clock.runFor(500);
  await expect(add).not.toHaveAttribute('aria-disabled');
  await other.close();
});

test('“Show recovery key” saves and copies this account’s key, even after a new key was left unsaved', async ({
  page,
  browser,
  baseURL,
}) => {
  // A new key shown by "Create an account" stayed in the page after a link
  // opened in the same tab, and the dialog's Download and Copy used it: a
  // key to no account (audit 6 A-1).
  const { key, code } = await createAccount(page);
  await page.getByRole('button', { name: 'Show a code' }).click();
  await expect(page.locator('[data-link-url]')).toHaveText(/#link=/);
  const url = (await page.locator('[data-link-url]').textContent()) ?? '';

  const other = await otherDevice(browser, baseURL);
  await other.grantPermissions(['clipboard-read', 'clipboard-write']);
  const second = await other.newPage();
  await second.goto('/account/');
  await second.getByRole('button', { name: 'Create an account' }).click();
  const unsaved = (await second.locator('[data-new-key]').textContent()) ?? '';
  expect(unsaved).toMatch(RECOVERY_KEY);
  // The link pasted into this tab's address bar: only the part after "#"
  // changes, so the page stays as it is.
  await second.evaluate((link) => {
    location.hash = new URL(link).hash;
  }, url);
  await expect(view(second, 'link-confirm')).toBeVisible();
  await expect(second.locator('[data-new-key]')).toHaveText('');
  const add = second.getByRole('button', { name: 'Add this device' });
  await expect(add).not.toHaveAttribute('aria-disabled');
  await add.click();
  await expect(accountCode(second)).toHaveText(code);

  await second.getByRole('button', { name: 'Show recovery key' }).click();
  const dialog = second.getByRole('dialog', { name: 'Your recovery key' });
  const status = dialog.locator('[data-dialog-status]');
  await expect(dialog.locator('[data-dialog-key]')).toHaveText(key);
  const download = second.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  const text = await downloadedText(await download);
  expect(text).toContain(key);
  expect(text).toContain(`Account code: ${code}`);
  expect(text).not.toContain(unsaved);
  await expect(status).toHaveText('Download started. Keep the file somewhere safe.');
  await dialog.getByRole('button', { name: 'Copy' }).click();
  // Keyboards' and computers' clipboard histories keep it (audit 7 A-3, run 39).
  await expect(status).toHaveText(
    'Copied. Some keyboards and computers keep a history of what’s copied: once you’ve pasted the key where you keep it, delete it from there.',
  );
  expect(await second.evaluate(() => navigator.clipboard.readText())).toBe(key);
  await other.close();
});

test('signed out in another tab: says so, closes the recovery key, and moves focus', async ({
  page,
}) => {
  // Not left showing the key of an account this device no longer has (audit 4 G-4).
  await createAccount(page);
  await page.getByRole('button', { name: 'Show recovery key' }).click();
  const keyDialog = page.getByRole('dialog', { name: 'Your recovery key' });
  await expect(keyDialog).toBeVisible();
  const other = await page.context().newPage();
  await other.goto('/account/');
  await signOut(other);
  await expect(message(page)).toHaveText('This device was signed out in another tab.');
  await expect(keyDialog).toBeHidden();
  await expect(view(page, 'signed-out')).toBeVisible();
  await expect(page.locator('[data-view="signed-out"] [tabindex="-1"]')).toBeFocused();
  await other.close();
});

test('making an account while another tab signs in says Continue switches this device to it (audit 7 G-12)', async ({
  page,
}) => {
  // "Save your recovery key" stayed as it was, and Continue then signed the
  // device in to the new account instead, without a word.
  await page.goto('/account/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  const warning = page.locator('[data-create-replace]');
  await expect(warning).toBeHidden();
  const other = await page.context().newPage();
  const first = await createAccount(other);
  await page.bringToFront();
  await expect(message(page)).toHaveText('This device was signed in, in another tab.');
  await expect(page.getByRole('heading', { name: 'Save your recovery key' })).toBeVisible();
  await expect(warning).toHaveText(
    'This device was signed in to an account in another tab. Continuing signs it in to this new account instead.',
  );
  await checkA11y(page, 'account: a new key while another tab signed in');
  // Signed out there again: nothing to switch from.
  await signOut(other);
  await expect(warning).toBeHidden();
  await createAccount(other);
  await expect(warning).toBeVisible();
  // Continuing does what it says.
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect(accountCode(page)).not.toHaveText(first.code);
  await other.close();
});

test('another account in another tab: the old one’s code stops working, and its key replacement goes', async ({
  page,
  browser,
  baseURL,
}) => {
  /** A code to add a device to a new account, made on a device of its own. */
  async function newAccountCode(): Promise<{ url: string; close: () => Promise<void> }> {
    const device = await otherDevice(browser, baseURL);
    const tab = await device.newPage();
    await createAccount(tab);
    await tab.getByRole('button', { name: 'Show a code' }).click();
    await expect(tab.locator('[data-link-url]')).toHaveText(/#link=/);
    return {
      url: (await tab.locator('[data-link-url]').textContent()) ?? '',
      close: () => device.close(),
    };
  }
  /** In `tab`, of this browser: opens the code, and switches to its account. */
  async function switchWith(tab: Page, url: string): Promise<void> {
    await tab.bringToFront();
    await tab.goto(url);
    await expect(tab.locator('[data-link-replace]')).toBeVisible();
    const add = tab.getByRole('button', { name: 'Add this device' });
    await expect(add).not.toHaveAttribute('aria-disabled');
    await add.click();
    await expect(view(tab, 'signed-in')).toBeVisible();
  }

  await createAccount(page);
  const cancelled = page.waitForResponse(
    (response) =>
      response.url().includes('/api/account/link/') && response.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Show a code' }).click();
  await expect(page.locator('[data-link-status]')).toHaveText(/Waiting for your other device/);
  const other = await page.context().newPage();
  const first = await newAccountCode();
  await switchWith(other, first.url);
  expect((await cancelled).status()).toBe(204);
  await expect(message(page)).toHaveText('The account on this device changed in another tab.');
  await expect(page.locator('[data-link-qr] svg')).toHaveCount(0);
  await expect(page.locator('[data-link-status]')).toHaveText('');

  // Replacing the key, started for the account before: it can't replace the new one's.
  await page.bringToFront();
  const before = (await accountCode(page).textContent()) ?? '';
  await page.getByRole('button', { name: 'Replace the account key' }).click();
  await page.getByRole('button', { name: 'Get a new key' }).click();
  await expect(page.getByRole('heading', { name: 'Save your new recovery key' })).toBeVisible();
  const second = await newAccountCode();
  await switchWith(other, second.url);
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect(accountCode(page)).not.toHaveText(before);
  await expect(view(page, 'new')).toBeHidden();
  await expect(page.locator('[data-new-key]')).toHaveText('');
  await expect(page.locator('[data-view="signed-in"] [tabindex="-1"]')).toBeFocused();
  await Promise.all([first.close(), second.close(), other.close()]);
});

test('“Done” makes the code stop working, so someone who saw it can’t use it', async ({
  page,
  browser,
  baseURL,
  guard,
}) => {
  // Audit A-2: hiding the code used to leave it working for its 10 minutes.
  await createAccount(page);
  await page.getByRole('button', { name: 'Show a code' }).click();
  await expect(page.locator('[data-link-status]')).toHaveText(/or until you tap Done\.$/);
  const url = (await page.locator('[data-link-url]').textContent()) ?? '';
  const cancelled = page.waitForResponse(
    (response) =>
      response.url().includes('/api/account/link/') && response.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Done' }).click();
  expect((await cancelled).status()).toBe(204);

  guard.allowConsole('Failed to load resource: the server responded with a status of 410 (Gone)');
  const other = await otherDevice(browser, baseURL);
  const second = await other.newPage();
  await second.goto(url);
  await expect(message(second)).toHaveText(/^This code has expired/);
  await expect(view(second, 'signed-out')).toBeVisible();
  await other.close();
});

test('a device whose clock runs ahead shows its code for the 10 minutes, then makes it stop working', async ({
  page,
  request,
}) => {
  // The page took the server's time of expiry by its own clock: 15 minutes
  // ahead, it hid the code at once as "expired", and left it working,
  // with nobody watching, for the rest of its 10 minutes (audit 6 A-1).
  await page.clock.install({ time: new Date(Date.now() + 15 * 60 * 1000) });
  await createAccount(page);
  await page.getByRole('button', { name: 'Show a code' }).click();
  const status = page.locator('[data-link-status]');
  await expect(status).toHaveText(/Waiting for your other device/);
  const url = (await page.locator('[data-link-url]').textContent()) ?? '';
  const id = /#link=([\w-]{22})\./.exec(url)?.[1] ?? '';
  // Two checks with the account service later, it's still there.
  await page.clock.runFor(4100);
  await expect(status).toHaveText(/Waiting for your other device/);
  await expect(page.locator('[data-link-qr] svg')).toHaveCount(1);

  // Its 10 minutes over, by this device's clock: hidden, and cancelled.
  const cancelled = page.waitForResponse(
    (response) =>
      response.url().includes('/api/account/link/') && response.request().method() === 'DELETE',
  );
  await page.clock.fastForward('10:00');
  await expect(status).toHaveText('The code expired. Show a new one if you still need it.');
  await expect(page.locator('[data-link-qr] svg')).toHaveCount(0);
  expect((await cancelled).status()).toBe(204);
  expect(await (await request.get(`/api/account/link/${id}/state`)).json()).toEqual({
    state: 'expired',
  });
});

test('asks before switching a signed-in device to another account', async ({
  page,
  browser,
  baseURL,
}) => {
  const first = await createAccount(page);
  const other = await otherDevice(browser, baseURL);
  const second = await other.newPage();
  const another = await createAccount(second);
  expect(another.code).not.toBe(first.code);

  await page.getByRole('button', { name: 'Show a code' }).click();
  await expect(page.locator('[data-link-url]')).toHaveText(/#link=/);
  const url = (await page.locator('[data-link-url]').textContent()) ?? '';
  await second.goto(url);
  await expect(second.locator('[data-link-replace]')).toBeVisible();
  await second.getByRole('button', { name: 'Cancel' }).click();
  await expect(accountCode(second)).toHaveText(another.code);
  await other.close();
});

/** Fills in the recovery key form and submits it. */
async function signInWithKey(page: Page, key: string): Promise<void> {
  if (await view(page, 'signed-out').isVisible()) {
    await page.getByRole('button', { name: 'Use my recovery key' }).click();
  }
  await page.getByRole('textbox', { name: 'Recovery key' }).fill(key);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Replaces the account key on a signed-in page; returns the new recovery key and code. */
async function replaceKey(page: Page): Promise<{ key: string; code: string }> {
  await page.getByRole('button', { name: 'Replace the account key' }).click();
  await expect(view(page, 'replace')).toBeVisible();
  await page.getByRole('button', { name: 'Get a new key' }).click();
  await expect(page.getByRole('heading', { name: 'Save your new recovery key' })).toBeVisible();
  const key = (await page.locator('[data-new-key]').textContent()) ?? '';
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Replace the key' }).click();
  await expect(message(page)).toHaveText(/^Your account key is replaced/);
  return { key, code: (await accountCode(page).textContent()) ?? '' };
}

test('replacing the key signs out every device that has the old one', async ({
  page,
  browser,
  baseURL,
}) => {
  const old = await createAccount(page);
  const tablet = await (await otherDevice(browser, baseURL)).newPage();
  await tablet.goto('/account/');
  await signInWithKey(tablet, old.key);
  await expect(accountCode(tablet)).toHaveText(old.code);
  // An app turned sync on there (what the Account page remembers when it does).
  const [synced] = syncApps;
  if (!synced) throw new Error('No app syncs');
  await tablet.evaluate(
    ({ app, code }) =>
      localStorage.setItem(
        'shkriuss-device:synced-apps',
        JSON.stringify([{ app, code, origin: `https://${app}.shkriuss.app` }]),
      ),
    { app: synced.slug, code: old.code },
  );

  // On the phone: replace the key. Nothing changes until the new key is saved.
  await page.getByRole('button', { name: 'Replace the account key' }).click();
  await expect(view(page, 'replace')).toBeVisible();
  // As under "Lost a device?": apps sync with the old key until sync is turned on again (audit F3-7).
  await expect(view(page, 'replace')).toContainText(
    'Their apps keep syncing until you turn on sync again in each app',
  );
  await checkA11y(page, 'account: replace the key');
  await page.getByRole('button', { name: 'Get a new key' }).click();
  const key = (await page.locator('[data-new-key]').textContent()) ?? '';
  expect(key).toMatch(RECOVERY_KEY);
  expect(key).not.toBe(old.key);
  const replace = page.getByRole('button', { name: 'Replace the key' });
  await expect(replace).toBeDisabled();
  await checkA11y(page, 'account: save the new recovery key');
  await page.getByLabel("I've saved my recovery key").check();
  await replace.click();
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect(message(page)).toHaveText(/^Your account key is replaced/);
  const code = (await accountCode(page).textContent()) ?? '';
  expect(code).toMatch(ACCOUNT_CODE);
  expect(code).not.toBe(old.code);
  await page.reload();
  await expect(accountCode(page)).toHaveText(code);

  // The tablet is signed out the next time it opens the page, and the old key can't sign in.
  await tablet.reload();
  await expect(view(tablet, 'signed-out')).toBeVisible();
  await expect(message(tablet)).toHaveText(/^Your account key was replaced on another device/);
  // As signing out does, it keeps neither the key nor its apps, and says
  // which app may still sync there with the old key (audit 3 D-8).
  await expect(message(tablet)).toContainText(
    `${synced.name} may still sync here with the old key: once you’re signed in, turn on sync in it again.`,
  );
  expect(
    await tablet.evaluate(() =>
      ['shkriuss-device:account', 'shkriuss-device:synced-apps'].map((key) =>
        localStorage.getItem(key),
      ),
    ),
  ).toEqual([null, null]);
  await checkA11y(tablet, 'account: signed out after the key was replaced');
  await signInWithKey(tablet, old.key);
  await expect(message(tablet)).toHaveText(/^This key was replaced on another device/);
  await expect(view(tablet, 'recovery')).toBeVisible();
  await signInWithKey(tablet, key);
  await expect(accountCode(tablet)).toHaveText(code);
  await tablet.context().close();
});

test('a mistake in the recovery key isn’t said again once fixed, when it fails for another reason (audit 7 G-10)', async ({
  page,
}) => {
  // It stayed under the box, marked as wrong, and was read out again as
  // focus came back there: the person kept looking for a typo.
  const old = await createAccount(page);
  await replaceKey(page);
  await signOut(page);
  const input = page.getByRole('textbox', { name: 'Recovery key' });
  const error = page.locator('#recovery-key-error');
  await signInWithKey(page, old.key.replace(/^./, old.key.startsWith('A') ? 'B' : 'A'));
  await expect(error).toHaveText(/There’s a mistake/);
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await signInWithKey(page, old.key);
  await expect(message(page)).toHaveText(/^This key was replaced on another device/);
  await expect(input).toBeFocused();
  await expect(error).toHaveText('');
  await expect(input).not.toHaveAttribute('aria-invalid');
});

/** What this device keeps about its account: the key, and the replaced keys. */
const storedAccount = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('shkriuss-device:account') ?? 'null') as {
        secret?: string;
        replaced?: string[];
      } | null,
  );

/**
 * Replaces the key on a signed-in page: the account service notes it, but
 * its answer is lost (the connection drops). Returns the new recovery key.
 */
async function replaceWithLostAnswer(page: Page): Promise<string> {
  await page.route('**/api/account/status', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await route.fetch();
    return route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Replace the account key' }).click();
  await page.getByRole('button', { name: 'Get a new key' }).click();
  const key = (await page.locator('[data-new-key]').textContent()) ?? '';
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Replace the key' }).click();
  await expect(page.locator('[data-new-status]')).toHaveText(/^Couldn’t reach shkriuss\.app/);
  await page.unrouteAll();
  return key;
}

/** Checks the page is signed in with `key`, keeping `old` for the apps to move their old copies. */
async function finishedWith(page: Page, key: string, old: string | undefined): Promise<void> {
  await page.getByRole('button', { name: 'Show recovery key' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your recovery key' });
  await expect(dialog.locator('[data-dialog-key]')).toHaveText(key);
  await dialog.getByRole('button', { name: 'Close' }).click();
  expect((await storedAccount(page))?.replaced).toEqual([old]);
}

test('a key replaced here whose answer never came is finished when the page opens again', async ({
  page,
  guard,
}) => {
  // The account service noted the old key as replaced, but its answer was
  // lost, and the page was closed: the next time, this device took itself
  // for a lost one, signed out and forgot the old key, so no app could move
  // its old copy any more (audit 6 A-1).
  const old = await createAccount(page);
  const oldSecret = (await storedAccount(page))?.secret;
  guard.allowConsole('net::ERR_CONNECTION_RESET');
  const key = await replaceWithLostAnswer(page);

  await page.reload();
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect(message(page)).toHaveText(/^Your account key is replaced\./);
  await expect(accountCode(page)).not.toHaveText(old.code);
  await finishedWith(page, key, oldSecret);
});

test('a key replaced here whose answer never came stays as it is when the check fails, then is finished (audit 7 A-1, run 27)', async ({
  page,
  guard,
}) => {
  // The page asked the account service twice as it opened: when only the
  // first check failed, the second took this device for a lost one. It
  // signed out, and forgot the old key (and the new one).
  const old = await createAccount(page);
  const oldSecret = (await storedAccount(page))?.secret;
  guard.allowConsole('net::ERR_CONNECTION_RESET');
  guard.allowConsole('net::ERR_FAILED');
  const key = await replaceWithLostAnswer(page);

  let checks = 0;
  await page.route('**/api/account/status', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    checks += 1;
    return checks === 1 ? route.abort('connectionreset') : route.fallback();
  });
  await page.reload();
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect(accountCode(page)).toHaveText(old.code);
  await expect(message(page)).toBeHidden();
  expect(checks).toBe(1);
  expect((await storedAccount(page))?.secret).toBe(oldSecret);

  await page.reload();
  await expect(message(page)).toHaveText(/^Your account key is replaced\./);
  await expect(accountCode(page)).not.toHaveText(old.code);
  expect(checks).toBe(2);
  await finishedWith(page, key, oldSecret);
});

test('says the old recovery key and passkeys still sign in when the old key couldn’t be noted (audit 7 A-4, run 27)', async ({
  page,
  guard,
}) => {
  // It said only that devices with the old key wouldn't sign out by
  // themselves: without the note, the old key isn't refused anywhere.
  await createAccount(page);
  guard.allowConsole('status of 507');
  await page.route('**/api/account/status', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 507, contentType: 'application/json', body: '{"error":"x"}' })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Replace the account key' }).click();
  // Before it's done, the page says that this holds only while the note is
  // kept: 13 months after the last try, they sign in again (audit 7 D-3).
  await expect(view(page, 'replace')).toContainText(
    "The old one, and your passkeys, can't sign in any more, for as long as the account service keeps its note about the old key: until no device has tried it for 13 months.",
  );
  await page.getByRole('button', { name: 'Get a new key' }).click();
  await expect(page.locator('[data-replace-only]')).toHaveText(
    "When you continue, your old recovery key and passkeys can't sign in any more, for as long as the account service keeps its note about the old key.",
  );
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Replace the key' }).click();
  await expect(message(page)).toHaveText(
    /^Your account key is replaced, but the account service had no room to note the old one just now\. So devices that still have it won’t sign out by themselves, and your old recovery key and passkeys can still sign in with it\. /,
  );
});

test('replacing the key again after an answer that never came shows the same new key, and finishes (audit 7 A-2, run 27)', async ({
  page,
  guard,
}) => {
  // It showed another new key: the page signed in with that one, while the
  // account service's note named the first, and each key signed in to an
  // account of its own.
  const old = await createAccount(page);
  const oldSecret = (await storedAccount(page))?.secret;
  guard.allowConsole('net::ERR_CONNECTION_RESET');
  const key = await replaceWithLostAnswer(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Replace the account key' }).click();
  await page.getByRole('button', { name: 'Get a new key' }).click();
  await expect(page.locator('[data-new-key]')).toHaveText(key);
  await expect(page.locator('[data-new-status]')).toHaveText(
    'It’s the same new key as last time, as replacing the key didn’t finish then.',
  );
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Replace the key' }).click();
  await expect(message(page)).toHaveText(/^Your account key is replaced\./);
  await expect(accountCode(page)).not.toHaveText(old.code);
  await finishedWith(page, key, oldSecret);
});

test('replacing a key another device replaced first signs this one out, and says so (audit 7 A-2, run 27)', async ({
  page,
  browser,
  baseURL,
}) => {
  // This device was told it had worked, and signed in with its own new key:
  // an account no other device had, and nothing ever signed it out.
  const old = await createAccount(page);
  const tablet = await (await otherDevice(browser, baseURL)).newPage();
  await tablet.goto('/account/');
  await signInWithKey(tablet, old.key);
  await expect(accountCode(tablet)).toHaveText(old.code);
  const theirs = await replaceKey(tablet);

  // The phone's page was open since before: it replaces the key too.
  await page.getByRole('button', { name: 'Replace the account key' }).click();
  await page.getByRole('button', { name: 'Get a new key' }).click();
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Replace the key' }).click();
  await expect(view(page, 'signed-out')).toBeVisible();
  await expect(message(page)).toHaveText(
    /^Your account key was already replaced on another device, so this device is signed out, and the new key you just saved isn’t used\./,
  );
  expect(await storedAccount(page)).toBeNull();
  await checkA11y(page, 'account: the key was already replaced');
  // With the key it was replaced with, it's on the tablet's account.
  await signInWithKey(page, theirs.key);
  await expect(accountCode(page)).toHaveText(theirs.code);
  await tablet.context().close();
});

test('asks the browser to keep the account on this device', async ({ page }) => {
  // The apps asked, the hub didn't, though it keeps the account key and the
  // replaced keys the apps need (audit 6 E-6).
  await page.addInitScript(() => {
    const asked = { times: 0 };
    Object.assign(window, { asked });
    Object.defineProperty(navigator.storage, 'persisted', {
      configurable: true,
      value: async () => false,
    });
    Object.defineProperty(navigator.storage, 'persist', {
      configurable: true,
      value: async () => {
        asked.times += 1;
        return true;
      },
    });
  });
  const asked = () =>
    page.evaluate(() => (window as unknown as { asked: { times: number } }).asked.times);
  await createAccount(page);
  await expect.poll(asked).toBe(1);
  // Signed in before this change: asked when the page opens.
  await page.reload();
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect.poll(asked).toBe(1);
  // Signed out, there's nothing to keep.
  await signOut(page);
  await page.reload();
  await expect(view(page, 'signed-out')).toBeVisible();
  expect(await asked()).toBe(0);
});

test('the dialogs read out what they mean, with their question (audit 5 G-3)', async ({ page }) => {
  const { code } = await createAccount(page);
  const dialog = page.getByRole('dialog', { name: 'Sign out of this device?' });
  await page.getByRole('button', { name: 'Sign out of this device' }).click();
  await expect(dialog).toHaveAccessibleDescription(
    /^To sign in again you.ll need your recovery key/,
  );
  await expect(dialog).not.toHaveAccessibleDescription(/keep syncing/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // With an app that syncs on this device, that it keeps syncing is read out too.
  const [synced] = syncApps;
  if (!synced) throw new Error('No app syncs');
  await page.evaluate(
    ({ app, code: accountCode }) =>
      localStorage.setItem(
        'shkriuss-device:synced-apps',
        JSON.stringify([{ app, code: accountCode, origin: `https://${app}.shkriuss.app` }]),
      ),
    { app: synced.slug, code },
  );
  await page.getByRole('button', { name: 'Sign out of this device' }).click();
  await expect(dialog).toHaveAccessibleDescription(
    new RegExp(`^To sign in again .* keep syncing after you sign out\\. .*${synced.name}\\.$`),
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Show recovery key' }).click();
  await expect(page.getByRole('dialog', { name: 'Your recovery key' })).toHaveAccessibleDescription(
    /^Anyone who sees it can sign in to your account/,
  );
});

test('lists the apps that sync, with links that turn on sync there', async ({ page }) => {
  await createAccount(page);
  for (const app of syncApps) {
    // Here on this computer, the hub can't tell the app's test address: it links to the real one.
    await expect(page.getByRole('link', { name: `Turn on sync in ${app.name}` })).toHaveAttribute(
      'href',
      `https://${app.slug}.${hub.domain}/#sync=connect`,
    );
  }
});

test('refuses to connect an app from the wrong address', async ({ page }) => {
  await createAccount(page);
  const key = 'B'.repeat(87);
  const state = 'C'.repeat(22);
  await page.goto(
    `/account/?connect=calendar&from=${encodeURIComponent('https://evil.example')}&key=${key}&state=${state}`,
  );
  await expect(message(page)).toHaveText(/This link to connect an app doesn’t work/);
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect(view(page, 'connect')).toBeHidden();

  // An app that doesn't sync can't ask either.
  await page.goto(
    `/account/?connect=nope&from=${encodeURIComponent('http://127.0.0.1:1')}&key=${key}&state=${state}`,
  );
  await expect(message(page)).toHaveText(/This link to connect an app doesn’t work/);
});

test('“Turn on sync for …” works only a moment after its question is on screen', async ({
  page,
  guard,
}) => {
  // Any website can bring this question up (ADR 0010), so a press sooner may
  // be the second click of a double-click it asked for, as for "Add this
  // device" (audit 4 C-6, audit 6 A-2).
  await createAccount(page);
  const [app] = syncApps;
  if (!app) throw new Error('No app syncs');
  // What an app sends: a one-time public key, and where to come back to.
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const key = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString(
    'base64url',
  );
  const state = randomBytes(16).toString('base64url');
  const from = 'http://127.0.0.1:1';
  guard.allowOrigin(from);
  await page.route(`${from}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>The app</p>' }),
  );
  // Paused: no timer fires but those the test runs.
  await page.clock.install({ time: new Date('2026-10-26T12:00:00') });
  await page.clock.pauseAt(new Date('2026-10-26T12:00:01'));
  await page.goto(
    `/account/?connect=${app.slug}&from=${encodeURIComponent(from)}&key=${key}&state=${state}`,
  );
  await expect(view(page, 'connect')).toBeVisible();
  const turnOn = page.getByRole('button', { name: `Turn on sync for ${app.name}` });
  await expect(turnOn).toHaveAttribute('aria-disabled', 'true');
  // A press meanwhile does nothing.
  await turnOn.focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(400);
  await expect(turnOn).toHaveAttribute('aria-disabled', 'true');
  await expect(view(page, 'connect')).toBeVisible();
  await page.clock.runFor(100);
  await expect(turnOn).not.toHaveAttribute('aria-disabled');
  // Away from the window and back: another half second, focus still on it.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(turnOn).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(turnOn).toBeFocused();
  await page.clock.runFor(500);
  await expect(turnOn).not.toHaveAttribute('aria-disabled');
  await turnOn.click();
  await page.waitForURL((url) => url.origin === from && url.hash.startsWith('#connect='));
});

test.describe('passkeys', () => {
  // Passkeys need a domain name (not 127.0.0.1); "localhost" counts as secure.
  const hub = sites.find((site) => site.slug === 'hub');
  test.use({ baseURL: `http://localhost:${hub?.port ?? 8787}` });

  async function authenticator(page: Page, prf: boolean): Promise<CDPSession> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf: prf,
        automaticPresenceSimulation: true,
      },
    });
    return cdp;
  }

  test('a passkey signs this device back in', async ({ page, guard }) => {
    await authenticator(page, true);
    const { code } = await createAccount(page);
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.locator('[data-passkey-status]')).toHaveText(/^Passkey added/);
    await signOut(page);

    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(view(page, 'signed-in')).toBeVisible();
    await expect(accountCode(page)).toHaveText(code);
    await expect(message(page)).toHaveText('Signed in with your passkey.');

    // Removed: it no longer signs in.
    guard.allowConsole(
      'Failed to load resource: the server responded with a status of 404 (Not Found)',
    );
    await page.getByRole('button', { name: 'Remove a passkey' }).click();
    await expect(page.locator('[data-passkey-status]')).toHaveText(
      'That passkey no longer signs in to your account.',
    );
    await signOut(page);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(message(page)).toHaveText(/isn’t connected to a shkriuss account|Cancelled/);
    await expect(view(page, 'signed-out')).toBeVisible();
  });

  test('a passkey for a replaced key can’t sign in', async ({ page }) => {
    await authenticator(page, true);
    await createAccount(page);
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.locator('[data-passkey-status]')).toHaveText(/^Passkey added/);
    await replaceKey(page);
    await signOut(page);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(message(page)).toHaveText(/^This passkey is for an account key that was replaced/);
    await expect(view(page, 'signed-out')).toBeVisible();
  });

  test('forgets a new passkey whose lock was refused, not one that may have been kept', async ({
    page,
    guard,
  }) => {
    // Left behind, it could get a lock made somewhere else first (audit 4 A-2).
    // But after a server error the lock may have been kept, and without the
    // passkey nobody could remove it.
    await authenticator(page, true);
    await page.addInitScript(() => {
      const signals: unknown[] = [];
      Object.assign(window, { signals });
      Object.defineProperty(PublicKeyCredential, 'signalUnknownCredential', {
        configurable: true,
        value: async (options: unknown) => {
          signals.push(options);
        },
      });
    });
    await createAccount(page);
    const signals = () =>
      page.evaluate(() => (window as unknown as { signals: unknown[] }).signals.length);
    let status = 500;
    guard.allowConsole(
      'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
    );
    guard.allowConsole(
      'Failed to load resource: the server responded with a status of 409 (Conflict)',
    );
    await page.route('**/api/account/passkey', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status, contentType: 'application/json', body: '{"error":"x"}' })
        : route.fallback(),
    );
    const add = page.getByRole('button', { name: 'Add a passkey' });
    const passkeyStatus = page.locator('[data-passkey-status]');
    await add.click();
    await expect(passkeyStatus).toHaveText(/^Couldn’t reach shkriuss\.app/);
    expect(await signals()).toBe(0);

    status = 409;
    await expect(add).not.toHaveAttribute('aria-disabled');
    await add.click();
    await expect.poll(signals).toBe(1);
    await expect(passkeyStatus).toHaveText(/^Couldn’t reach shkriuss\.app/);
    expect(
      await page.evaluate(() => (window as unknown as { signals: unknown[] }).signals[0]),
    ).toMatchObject({ rpId: 'localhost' });
  });

  test('explains when a password manager can’t unlock accounts', async ({ page }) => {
    await authenticator(page, false);
    await createAccount(page);
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.locator('[data-passkey-status]')).toHaveText(
      /can’t use a passkey to unlock an account/,
    );
  });
});

test.describe('the account service', () => {
  const newId = () => randomBytes(16).toString('base64url');
  const sealed = 'A'.repeat(80);

  test('accepts only small sealed values, from this site', async ({ request }) => {
    expect((await request.get('/api/account/ping')).status()).toBe(200);
    const put = (data: unknown, headers: Record<string, string> = {}) =>
      request.put(`/api/account/link/${newId()}`, { data, headers });
    expect((await put({ data: 'short' })).status()).toBe(400);
    expect((await put({ data: sealed, extra: true })).status()).toBe(400);
    expect((await put({ data: 'A'.repeat(5000) })).status()).toBe(413);
    expect((await put({ data: sealed }, { 'Sec-Fetch-Site': 'cross-site' })).status()).toBe(403);
    // Nor from a page on another of our own subdomains, like an app's (audit 3 J-3).
    expect((await put({ data: sealed }, { 'Sec-Fetch-Site': 'same-site' })).status()).toBe(403);
    expect((await request.get('/api/account/link/not-an-id')).status()).toBe(404);
    expect((await request.get('/api/account/passkey')).status()).toBe(401);
    expect((await request.get('/api/account/status')).status()).toBe(401);
    const token = { Authorization: `Bearer ${randomBytes(32).toString('base64url')}` };
    expect(await (await request.get('/api/account/status', { headers: token })).json()).toEqual({
      replaced: false,
    });
    expect((await request.delete('/api/account/status', { headers: token })).status()).toBe(405);
    expect((await request.get('/api/account/nothing')).status()).toBe(404);
  });

  test('gives out a link once, then only says it was used', async ({ request }) => {
    const linkId = newId();
    const created = await request.put(`/api/account/link/${linkId}`, { data: { data: sealed } });
    expect(created.status()).toBe(201);
    expect(
      (await request.put(`/api/account/link/${linkId}`, { data: { data: sealed } })).status(),
    ).toBe(409);
    expect(await (await request.get(`/api/account/link/${linkId}/state`)).json()).toEqual({
      state: 'waiting',
    });
    expect(await (await request.get(`/api/account/link/${linkId}`)).json()).toEqual({
      data: sealed,
    });
    expect((await request.get(`/api/account/link/${linkId}`)).status()).toBe(410);
    expect(await (await request.get(`/api/account/link/${linkId}/state`)).json()).toEqual({
      state: 'used',
    });
  });
});
