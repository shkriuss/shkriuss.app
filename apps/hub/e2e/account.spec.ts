// The optional shkriuss account (packages/account, docs/adr/0010): creating
// one, the recovery key, adding a device with a one-time code, passkeys, and
// what the account service accepts.
import { randomBytes } from 'node:crypto';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { sites } from '../../../tests/e2e/sites.ts';

const RECOVERY_KEY = /^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/;
const ACCOUNT_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

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

  await expect(page.locator('[data-link-status]')).toHaveText('Your other device is signed in.');
  await expect(page.locator('[data-link-qr] svg')).toHaveCount(0);

  // A code works once.
  guard.allowConsole('410');
  const third = await (await otherDevice(browser, baseURL)).newPage();
  await third.goto(url);
  await expect(message(third)).toHaveText(/already used, or has expired/);
  await expect(view(third, 'signed-out')).toBeVisible();
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
