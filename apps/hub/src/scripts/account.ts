/**
 * The Account page (pages/account.astro). How the account works:
 * packages/account and docs/adr/0010-account-and-sync.md.
 */
import {
  AccountError,
  accountCodeOf,
  addPasskey,
  appSecretOf,
  claimLink,
  createLink,
  currentAccount,
  forgetAccount,
  generateSecret,
  linkState,
  parseLinkFragment,
  parseRecoveryKey,
  passkeySupport,
  recoveryKeyOf,
  removePasskey,
  sameSecret,
  saveAccount,
  signInWithPasskey,
  type Account,
  type AccountErrorCode,
  type DeviceLink,
  type LinkState,
} from '@shkriuss/account';
import { apps, type AppEntry } from '@shkriuss/registry';
import { downloadFile } from '@shkriuss/storage';
import {
  connectResultUrl,
  parseConnectRequest,
  sealForApp,
  type ConnectRequest,
} from '@shkriuss/sync/connect';
import { isAppOrigin } from '@shkriuss/sync/origins';
import { renderQrCode } from '@shkriuss/ui/qr-code';

type View =
  'loading' | 'signed-out' | 'recovery' | 'new' | 'link-confirm' | 'signed-in' | 'connect';

/** An app asking to connect (from its "Turn on sync"), if the request is real. */
function connectRequestOf(
  search: string,
): { request: ConnectRequest; app: AppEntry } | 'invalid' | null {
  const request = parseConnectRequest(search);
  if (!request) return new URLSearchParams(search).has('connect') ? 'invalid' : null;
  const app = apps.find((entry) => entry.slug === request.app && entry.sync === true);
  if (!app || !isAppOrigin(request.from, app.slug, new URL(location.href))) return 'invalid';
  return { request, app };
}

/** How often a shown code checks whether the other device has used it. */
const LINK_POLL_MS = 2000;

const PROBLEMS: Record<AccountErrorCode, string> = {
  cancelled: 'Cancelled.',
  'no-prf':
    'This browser or password manager can’t use a passkey to unlock an account. Use your recovery key, or add this device with a code from another one. (Google Password Manager on Android and iCloud Keychain on iPhone, iPad and Mac can.)',
  'unknown-passkey':
    'That passkey isn’t connected to a shkriuss account. Try another passkey, or use your recovery key.',
  'link-used': 'This code was already used, or has expired. Show a new one on your other device.',
  server: 'Couldn’t reach shkriuss.app. Check your connection and try again.',
};

const problemOf = (error: unknown): string =>
  error instanceof AccountError ? (PROBLEMS[error.code] ?? PROBLEMS.server) : PROBLEMS.server;

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Account: missing element ${selector}`);
  return element;
}

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The text of the downloaded recovery key file. */
function recoveryFile(key: string, code: string): string {
  return [
    'shkriuss account: recovery key',
    '',
    key,
    '',
    `Account code: ${code}`,
    `Saved: ${today()}`,
    '',
    'Keep this somewhere safe, like a password manager. Anyone with this key can sign in',
    'to your shkriuss account. If you lose it and every signed-in device, nobody can get',
    'your account back.',
    '',
    `To sign in: open ${location.origin}/account/, choose "Use my recovery key", and type`,
    'or paste the key.',
    '',
  ].join('\n');
}

export async function mountAccount(root: HTMLElement): Promise<void> {
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const message = required<HTMLElement>(root, '[data-message]');
  const views = [...root.querySelectorAll<HTMLElement>('[data-view]')];

  const recoveryForm = required<HTMLFormElement>(root, '[data-recovery-form]');
  const recoveryInput = required<HTMLTextAreaElement>(recoveryForm, '[name="key"]');
  const recoveryError = required<HTMLElement>(recoveryForm, '[data-error-for="key"]');

  const newKey = required<HTMLElement>(root, '[data-new-key]');
  const newStatus = required<HTMLElement>(root, '[data-new-status]');
  const savedCheck = required<HTMLInputElement>(root, '[data-saved-check]');
  const finishCreate = required<HTMLButtonElement>(root, '[data-action="finish-create"]');

  const linkCode = required<HTMLElement>(root, '[data-link-code]');
  const linkReplace = required<HTMLElement>(root, '[data-link-replace]');

  const accountCode = required<HTMLElement>(root, '[data-account-code]');
  const linkPanel = required<HTMLElement>(root, '[data-link-panel]');
  const linkQr = required<HTMLElement>(root, '[data-link-qr]');
  const linkUrl = required<HTMLElement>(root, '[data-link-url]');
  const linkStatus = required<HTMLElement>(root, '[data-link-status]');
  const createLinkButton = required<HTMLButtonElement>(root, '[data-action="create-link"]');
  const passkeyStatus = required<HTMLElement>(root, '[data-passkey-status]');

  const keyDialog = required<HTMLDialogElement>(root, '[data-key-dialog]');
  const dialogKey = required<HTMLElement>(keyDialog, '[data-dialog-key]');
  const dialogStatus = required<HTMLElement>(keyDialog, '[data-dialog-status]');
  const signOutDialog = required<HTMLDialogElement>(root, '[data-sign-out-dialog]');

  const connectNote = required<HTMLElement>(root, '[data-connect-note]');
  const connectCode = required<HTMLElement>(root, '[data-connect-code]');
  const connecting = connectRequestOf(location.search);
  if (connecting === 'invalid') {
    message.hidden = false;
    message.classList.add('notice--danger');
    message.textContent =
      'This link to connect an app doesn’t work. Open the app and tap “Turn on sync” again.';
  } else if (connecting) {
    for (const name of root.querySelectorAll('[data-connect-app]')) {
      name.textContent = connecting.app.name;
    }
    connectNote.hidden = false;
  }

  let account: Account | null = await currentAccount();
  /** A new account's secret, until the person confirms they saved its key. */
  let pending: { secret: Uint8Array<ArrayBuffer>; key: string; code: string } | null = null;
  /** A secret from a device link, until the person confirms. */
  let linked: Uint8Array<ArrayBuffer> | null = null;
  let link: DeviceLink | null = null;
  let poll: number | undefined;

  const announce = (text: string) => {
    announcer.textContent = text;
  };

  function say(text: string | null, danger = false): void {
    message.hidden = text === null;
    message.textContent = text ?? '';
    message.classList.toggle('notice--danger', danger);
  }

  function show(view: View, focus = true): void {
    for (const element of views) element.hidden = element.dataset['view'] !== view;
    if (view === 'signed-in' && account) accountCode.textContent = account.code;
    if (focus) root.querySelector<HTMLElement>(`[data-view="${view}"] [tabindex="-1"]`)?.focus();
  }

  function home(focus = true): void {
    if (account && connecting && connecting !== 'invalid') {
      connectCode.textContent = account.code;
      show('connect', focus);
    } else {
      show(account ? 'signed-in' : 'signed-out', focus);
    }
  }

  async function signIn(secret: Uint8Array<ArrayBuffer>, done: string): Promise<void> {
    if (!saveAccount(secret)) {
      say(
        'This browser won’t save the account. Is it in private mode, or is storage blocked?',
        true,
      );
      return;
    }
    account = await currentAccount();
    stopLink();
    home();
    say(done);
    announce(done);
  }

  async function copy(text: string, status: HTMLElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied.';
    } catch {
      status.textContent = 'Couldn’t copy. Select the text and copy it instead.';
    }
  }

  // ---------- Device links ----------

  function stopLink(): void {
    window.clearInterval(poll);
    poll = undefined;
    link = null;
    linkPanel.hidden = true;
    linkQr.replaceChildren();
    linkUrl.textContent = '';
    createLinkButton.hidden = false;
  }

  async function checkLink(): Promise<void> {
    if (!link || document.hidden) return;
    const shown = link;
    let state: LinkState;
    try {
      state = await linkState(shown.id);
    } catch {
      return; // Try again on the next tick.
    }
    if (link !== shown) return;
    if (state === 'used') {
      stopLink();
      linkStatus.textContent = 'Your other device is signed in.';
    } else if (state === 'expired' || Date.now() > shown.expiresAt) {
      stopLink();
      linkStatus.textContent = 'The code expired. Show a new one if you still need it.';
    }
  }

  async function startLink(): Promise<void> {
    if (!account) return;
    stopLink();
    createLinkButton.disabled = true;
    linkStatus.textContent = 'Making a code…';
    try {
      link = await createLink(account.secret);
    } catch (error) {
      linkStatus.textContent = problemOf(error);
      return;
    } finally {
      createLinkButton.disabled = false;
    }
    renderQrCode(linkQr, link.url, 'QR code to add another device to your account');
    linkUrl.textContent = link.url;
    linkPanel.hidden = false;
    createLinkButton.hidden = true;
    linkStatus.textContent = `Waiting for your other device. The code works once, until ${timeFormat.format(link.expiresAt)}.`;
    poll = window.setInterval(() => void checkLink(), LINK_POLL_MS);
  }

  /** Opened from a scanned code: fetch the account, then ask before using it. */
  async function openLink(hash: string): Promise<boolean> {
    const found = parseLinkFragment(hash);
    if (!found) return false;
    // The key must not stay in the address bar or history.
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    announce('Adding this device…');
    try {
      linked = await claimLink(found);
    } catch (error) {
      home(false);
      say(problemOf(error), true);
      return true;
    }
    if (account && sameSecret(account.secret, linked)) {
      linked = null;
      home();
      say('This device is already signed in to this account.');
      return true;
    }
    linkCode.textContent = await accountCodeOf(linked);
    linkReplace.hidden = !account;
    show('link-confirm');
    return true;
  }

  // ---------- Passkeys ----------

  const support = await passkeySupport();
  if (support === 'no') {
    for (const element of root.querySelectorAll<HTMLElement>('[data-needs-passkey]')) {
      element.hidden = true;
    }
    passkeyStatus.textContent = 'This browser can’t use passkeys. Use your recovery key instead.';
  }

  async function withButton(button: HTMLButtonElement, task: () => Promise<void>): Promise<void> {
    button.disabled = true;
    try {
      await task();
    } finally {
      button.disabled = false;
    }
  }

  // ---------- Actions ----------

  const actions: Record<string, (button: HTMLButtonElement) => void | Promise<void>> = {
    create: async () => {
      say(null);
      const secret = generateSecret();
      pending = { secret, key: await recoveryKeyOf(secret), code: await accountCodeOf(secret) };
      newKey.textContent = pending.key;
      newStatus.textContent = '';
      savedCheck.checked = false;
      finishCreate.disabled = true;
      show('new');
    },
    'finish-create': async () => {
      if (!pending) return;
      const { secret } = pending;
      pending = null;
      newKey.textContent = '';
      await signIn(secret, 'Your account is ready, and this device is signed in.');
    },
    'download-key': async () => {
      const source =
        pending ?? (account && { key: await recoveryKeyOf(account.secret), code: account.code });
      if (!source) return;
      downloadFile(
        'shkriuss-recovery-key.txt',
        recoveryFile(source.key, source.code),
        'text/plain',
      );
      (pending ? newStatus : dialogStatus).textContent =
        'Downloaded. Keep the file somewhere safe.';
    },
    'copy-key': async () => {
      if (pending) await copy(pending.key, newStatus);
      else if (account) await copy(await recoveryKeyOf(account.secret), dialogStatus);
    },
    'show-recovery-form': () => {
      say(null);
      recoveryInput.value = '';
      recoveryError.textContent = '';
      recoveryInput.removeAttribute('aria-invalid');
      show('recovery');
      recoveryInput.focus();
    },
    back: () => {
      pending = null;
      linked = null;
      newKey.textContent = '';
      home();
    },
    'passkey-sign-in': (button) =>
      withButton(button, async () => {
        say(null);
        try {
          await signIn(await signInWithPasskey(), 'Signed in with your passkey.');
        } catch (error) {
          say(problemOf(error), !(error instanceof AccountError && error.code === 'cancelled'));
        }
      }),
    'accept-connect': async (button) => {
      if (!account || !connecting || connecting === 'invalid') return;
      button.disabled = true;
      const { request, app } = connecting;
      const secret = await appSecretOf(account.secret, app.slug);
      const result = await sealForApp(request, { secret, code: account.code });
      location.replace(connectResultUrl(request.from, result));
    },
    'cancel-connect': () => {
      if (!connecting || connecting === 'invalid') return;
      location.replace(connectResultUrl(connecting.request.from, 'cancelled'));
    },
    'accept-link': async () => {
      if (!linked) return;
      const secret = linked;
      linked = null;
      await signIn(secret, 'This device is now signed in to your account.');
    },
    'create-link': () => startLink(),
    'close-link': () => {
      stopLink();
      linkStatus.textContent = '';
      createLinkButton.focus();
    },
    'copy-link': async () => {
      if (link) await copy(link.url, linkStatus);
    },
    'add-passkey': (button) =>
      withButton(button, async () => {
        if (!account) return;
        passkeyStatus.textContent = 'Follow your browser’s steps to save the passkey…';
        try {
          await addPasskey(account.secret, account.code);
          passkeyStatus.textContent =
            'Passkey added. You can now sign in with it on any device that has it.';
        } catch (error) {
          passkeyStatus.textContent = problemOf(error);
        }
      }),
    'remove-passkey': (button) =>
      withButton(button, async () => {
        passkeyStatus.textContent = 'Choose the passkey to remove…';
        try {
          await removePasskey();
          passkeyStatus.textContent = 'That passkey no longer signs in to your account.';
        } catch (error) {
          passkeyStatus.textContent =
            error instanceof AccountError && error.code === 'unknown-passkey'
              ? 'That passkey wasn’t connected to an account.'
              : problemOf(error);
        }
      }),
    'show-key': async () => {
      if (!account) return;
      dialogKey.textContent = await recoveryKeyOf(account.secret);
      dialogStatus.textContent = '';
      keyDialog.showModal();
    },
    'close-dialog': () => {
      keyDialog.close();
    },
    'sign-out': () => {
      signOutDialog.returnValue = '';
      signOutDialog.showModal();
    },
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    const action = button && actions[button.dataset['action'] ?? ''];
    if (button && action) void action(button);
  });

  savedCheck.addEventListener('change', () => {
    finishCreate.disabled = !savedCheck.checked;
  });

  recoveryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const result = await parseRecoveryKey(recoveryInput.value);
      if (!result.ok) {
        recoveryError.textContent =
          result.problem === 'format'
            ? 'That isn’t a recovery key. It has 56 letters and digits, in groups of 4.'
            : 'There’s a mistake in it. Check each group against your saved key.';
        recoveryInput.setAttribute('aria-invalid', 'true');
        recoveryInput.focus();
        return;
      }
      recoveryInput.value = '';
      await signIn(result.secret, 'Signed in with your recovery key.');
    })();
  });

  keyDialog.addEventListener('close', () => {
    dialogKey.textContent = '';
  });

  signOutDialog.addEventListener('close', () => {
    if (signOutDialog.returnValue !== 'confirm') return;
    forgetAccount();
    account = null;
    stopLink();
    linkStatus.textContent = '';
    show('signed-out');
    say('This device is signed out.');
    announce('This device is signed out.');
  });

  // Signed in or out in another tab: follow along.
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== 'shkriuss-device:account') return;
    void currentAccount().then((current) => {
      account = current;
      if (!current) stopLink();
      if (!pending && !linked) home(false);
    });
  });

  window.addEventListener('hashchange', () => void openLink(location.hash));

  if (!(await openLink(location.hash))) home(false);
}
