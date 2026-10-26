// The optional shkriuss account (packages/account, docs/adr/0010): creating
// one, the recovery key, adding a device with a one-time code, passkeys, and
// what the account service accepts.
import { randomBytes } from 'node:crypto';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
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

test('creates an account once the recovery key is saved', async ({ page }) => {
  await page.goto('/account/');
  await expect(view(page, 'signed-out')).toBeVisible();
  await checkA11y(page, 'account: signed out');

  await page.getByRole('button', { name: 'Create an account' }).click();
  const key = (await page.locator('[data-new-key]').textContent()) ?? '';
  expect(key).toMatch(RECOVERY_KEY);
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  await checkA11y(page, 'account: save the recovery key');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recovery key' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('shkriuss-recovery-key.txt');
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
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

  await input.fill('not a key');
  await signIn.click();
  await expect(error).toHaveText(/isn’t a recovery key/);
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  const typo = key.replace(/^./, key.startsWith('A') ? 'B' : 'A');
  await input.fill(typo);
  await signIn.click();
  await expect(error).toHaveText(/There’s a mistake/);
  await checkA11y(page, 'account: recovery key with a mistake');

  await input.fill(` ${key.toLowerCase().replace(/-/g, ' ')} `);
  await signIn.click();
  await expect(view(page, 'signed-in')).toBeVisible();
  await expect(accountCode(page)).toHaveText(code);
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
  await checkA11y(second, 'account: confirm a linked device');
  await second.getByRole('button', { name: 'Add this device' }).click();
  await expect(view(second, 'signed-in')).toBeVisible();
  await expect(accountCode(second)).toHaveText(code);

  await expect(page.locator('[data-link-status]')).toHaveText(
    /^A device used this code and is now signed in\. If it wasn’t the one you meant/,
  );
  await expect(page.locator('[data-link-qr] svg')).toHaveCount(0);

  // A code works once.
  guard.allowConsole('410');
  const third = await (await otherDevice(browser, baseURL)).newPage();
  await third.goto(url);
  // Used by someone else first: the person is told, and what to do.
  await expect(message(third)).toHaveText(/^Someone already used this code\. If it wasn’t you/);
  await expect(view(third, 'signed-out')).toBeVisible();
  await other.close();
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

  guard.allowConsole('410');
  const other = await otherDevice(browser, baseURL);
  const second = await other.newPage();
  await second.goto(url);
  await expect(message(second)).toHaveText(/^This code has expired/);
  await expect(view(second, 'signed-out')).toBeVisible();
  await other.close();
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
    guard.allowConsole('404');
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
