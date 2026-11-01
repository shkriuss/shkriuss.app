/**
 * The Account page (pages/account.astro). How the account works:
 * packages/account and docs/adr/0010-account-and-sync.md.
 */
import {
  AccountError,
  accountCodeOf,
  addPasskey,
  appSecretOf,
  cancelLink,
  claimLink,
  createLink,
  currentAccount,
  finishReplacing,
  forgetAccount,
  generateSecret,
  isReplaced,
  linkState,
  noteSyncOff,
  noteSyncOn,
  parseLinkFragment,
  parseRecoveryKey,
  passkeySupport,
  recoveryKeyOf,
  removePasskey,
  replaceAccountKey,
  replacedSecrets,
  sameSecret,
  saveAccount,
  signInWithPasskey,
  signOutIfReplaced,
  syncedApps,
  type Account,
  type AccountErrorCode,
  type DeviceLink,
  type LinkState,
} from '@shkriuss/account';
import { today } from '@shkriuss/dates';
import { apps, type AppEntry } from '@shkriuss/registry';
import { downloadFile, keepData } from '@shkriuss/storage';
import {
  connectResultUrl,
  isConnectKey,
  parseConnectRequest,
  sealForApp,
  turnOffProof,
  turnOffUrl,
  type ConnectRequest,
} from '@shkriuss/sync/connect';
import { appOriginFor, isAppOrigin } from '@shkriuss/sync/origins';
import { focusProblem } from '@shkriuss/ui/problem';
import { setBusy } from '@shkriuss/ui/busy';
import { renderQrCode } from '@shkriuss/ui/qr-code';
import { DATE_LOCALE } from '@shkriuss/ui/locale';
import { required } from '@shkriuss/ui/dom';

type View =
  | 'loading'
  | 'signed-out'
  | 'recovery'
  | 'new'
  | 'replace'
  | 'link-confirm'
  | 'signed-in'
  | 'connect';

/** An app asking to connect (from its "Turn on sync"), if the request is real. */
async function connectRequestOf(
  search: string,
): Promise<{ request: ConnectRequest; app: AppEntry } | 'invalid' | null> {
  const request = parseConnectRequest(search);
  if (!request) return new URLSearchParams(search).has('connect') ? 'invalid' : null;
  const app = apps.find((entry) => entry.slug === request.app && entry.sync === true);
  if (!app || !isAppOrigin(request.from, app.slug, new URL(location.href))) return 'invalid';
  // A key that isn't one would only fail on the confirm button, leaving it busy for good (audit 5 A-3).
  if (!(await isConnectKey(request.key))) return 'invalid';
  return { request, app };
}

const CONNECT_BROKEN =
  'This link to connect an app doesn’t work. Open the app and tap “Turn on sync” again.';

/** How often a shown code checks whether the other device has used it. */
const LINK_POLL_MS = 2000;
/** A message that appears is shown (and read out) this long after it's put on the page. */
const SAY_DELAY_MS = 100;
/** "Add this device" and "Turn on sync for …" work this long after their question is on screen (see holdAccept). */
const ACCEPT_DELAY_MS = 500;

const PROBLEMS: Record<AccountErrorCode, string> = {
  cancelled: 'Cancelled.',
  'no-prf':
    'This browser or password manager can’t use a passkey to unlock an account. Use your recovery key, or add this device with a code from another one. (Google Password Manager on Android and iCloud Keychain on iPhone, iPad and Mac can.)',
  'unknown-passkey':
    'That passkey isn’t connected to a shkriuss account. Try another passkey, or use your recovery key.',
  'old-passkey':
    'This passkey was added before a security update, so it can’t sign in any more. Sign in with your recovery key, or add this device with a code from another one, then add a passkey again.',
  'passkey-refused':
    'The account service didn’t accept this passkey. Check that this device’s date and time are right and try again, or use your recovery key.',
  'link-used': 'This code has expired. Show a new one on your other device.',
  'link-taken':
    'Someone already used this code. If it wasn’t you, replace your account key on your other device now: whoever used it can see what you sync.',
  server: 'Couldn’t reach shkriuss.app. Check your connection and try again.',
};

const problemOf = (error: unknown): string =>
  error instanceof AccountError ? (PROBLEMS[error.code] ?? PROBLEMS.server) : PROBLEMS.server;

const SIGN_IN_AGAIN =
  'Sign in with your new recovery key, or add this device with a code from one of your signed-in devices.';
/**
 * What to do next, after replacing the key. Reminders while an app is
 * closed aren't tied to the account: replacing it doesn't stop them on a
 * lost device (audit 3 A-1). Old passkeys can still unlock the old key
 * (audit 3 D-8).
 */
const AFTER_REPLACING = [
  'Now turn on sync again in each app (below), on each of your devices: until then, a lost device can still see that app’s changes.',
  ...(apps.some((app) => app.pushNotifications === true)
    ? [
        'Reminders while an app is closed still reach a lost device until you erase it (Find My, Find My Device).',
      ]
    : []),
  'If you use passkeys, remove the old ones and add a new one.',
].join(' ');
const REPLACED = {
  here: `Your account key was replaced on another device, so this device is signed out. ${SIGN_IN_AGAIN}`,
  key: `This key was replaced on another device, so it can’t sign in any more. ${SIGN_IN_AGAIN}`,
  passkey: `This passkey is for an account key that was replaced on another device, so it can’t sign in any more. ${SIGN_IN_AGAIN} Then you can add a new passkey.`,
  done: `Your account key is replaced. Devices with the old key are signed out when they next open this page. ${AFTER_REPLACING}`,
  unnoted: `Your account key is replaced, but the account service had no room to note the old one just now, so devices that still have it won’t sign out by themselves. ${AFTER_REPLACING}`,
};

const listFormat = new Intl.ListFormat('en-GB', { type: 'conjunction' });

/**
 * REPLACED.here, naming the apps that synced on this device with the
 * replaced key: they still may, and this device no longer lists them
 * (audit 3 D-8).
 */
const replacedHere = (names: readonly string[]): string =>
  names.length === 0
    ? REPLACED.here
    : `${REPLACED.here} ${listFormat.format(names)} may still sync here with the old key: once you’re signed in, turn on sync in ${names.length === 1 ? 'it' : 'each'} again.`;

/** Someone used the device code: maybe not the person (audit A-5). */
const LINK_USED =
  'A device used this code and is now signed in. If it wasn’t the one you meant, replace your account key now (below).';

/** True if this key was replaced on another device (false if that can't be checked now). */
const wasReplaced = (secret: Uint8Array<ArrayBuffer>): Promise<boolean> =>
  isReplaced(secret).catch(() => false);

const timeFormat = new Intl.DateTimeFormat(DATE_LOCALE, { hour: 'numeric', minute: '2-digit' });

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
  const recoverySubmit = required<HTMLButtonElement>(recoveryForm, 'button[type="submit"]');

  const newTitle = required<HTMLElement>(root, '[data-new-title]');
  const newKey = required<HTMLElement>(root, '[data-new-key]');
  const newStatus = required<HTMLElement>(root, '[data-new-status]');
  const replaceOnly = required<HTMLElement>(root, '[data-replace-only]');
  const finishLabel = required<HTMLElement>(root, '[data-finish-label]');
  const savedCheck = required<HTMLInputElement>(root, '[data-saved-check]');
  const finishCreate = required<HTMLButtonElement>(root, '[data-action="finish-create"]');

  const linkCode = required<HTMLElement>(root, '[data-link-code]');
  const acceptLinkButton = required<HTMLButtonElement>(root, '[data-action="accept-link"]');
  const linkReplace = required<HTMLElement>(root, '[data-link-replace]');

  const accountCode = required<HTMLElement>(root, '[data-account-code]');
  const linkPanel = required<HTMLElement>(root, '[data-link-panel]');
  const linkQr = required<HTMLElement>(root, '[data-link-qr]');
  const linkUrl = required<HTMLElement>(root, '[data-link-url]');
  const linkStatus = required<HTMLElement>(root, '[data-link-status]');
  const createLinkButton = required<HTMLButtonElement>(root, '[data-action="create-link"]');
  const copyLinkButton = required<HTMLButtonElement>(linkPanel, '[data-action="copy-link"]');
  const passkeyStatus = required<HTMLElement>(root, '[data-passkey-status]');

  const keyDialog = required<HTMLDialogElement>(root, '[data-key-dialog]');
  const dialogKey = required<HTMLElement>(keyDialog, '[data-dialog-key]');
  const dialogStatus = required<HTMLElement>(keyDialog, '[data-dialog-status]');
  const signOutDialog = required<HTMLDialogElement>(root, '[data-sign-out-dialog]');
  const signOutApps = required<HTMLElement>(root, '[data-sign-out-apps]');
  const signOutAppNames = required<HTMLElement>(root, '[data-sign-out-app-names]');

  const connectNote = required<HTMLElement>(root, '[data-connect-note]');
  const connectCode = required<HTMLElement>(root, '[data-connect-code]');
  const acceptConnectButton = required<HTMLButtonElement>(root, '[data-action="accept-connect"]');
  const connecting = await connectRequestOf(location.search);
  if (connecting === 'invalid') {
    message.hidden = false;
    message.classList.add('notice--danger');
    message.textContent = CONNECT_BROKEN;
  } else if (connecting) {
    for (const name of root.querySelectorAll('[data-connect-app]')) {
      name.textContent = connecting.app.name;
    }
    connectNote.hidden = false;
  }

  // The links to turn sync on in apps: to this hub's own apps.
  const syncLinks = [...root.querySelectorAll<HTMLAnchorElement>('a[data-sync-app]')].map(
    (link) => {
      const slug = link.dataset['syncApp'] ?? '';
      const origin = appOriginFor(new URL(location.href), slug);
      if (origin) link.href = `${origin}/#sync=connect`;
      const name = apps.find((app) => app.slug === slug)?.name ?? slug;
      return { link, slug, name, turnOn: link.href };
    },
  );

  let account: Account | null = await currentAccount();
  /** A new key (a new account, or replacing this one), until the person confirms they saved it. */
  let pending: {
    secret: Uint8Array<ArrayBuffer>;
    key: string;
    code: string;
    replacing: boolean;
  } | null = null;
  /** A secret from a device link, until the person confirms. */
  let linked: Uint8Array<ArrayBuffer> | null = null;
  let link: DeviceLink | null = null;
  let poll: number | undefined;

  const announce = (text: string) => {
    announcer.textContent = text;
  };

  /** Counts messages, so a newer one wins over one still waiting to be shown (see say). */
  let said = 0;

  /**
   * Shows a message, which is read out (null hides it). The message is a
   * live region, and one that appears with its text already in it isn't
   * always read out. So when it was hidden, it's put on the page empty (and
   * invisible) first, and its text follows a moment later. That way it needs
   * no second live region saying the same thing (audit G-14).
   */
  function say(text: string | null, danger = false): void {
    said += 1;
    const turn = said;
    const appearing = text !== null && message.hidden !== false;
    message.classList.toggle('notice--danger', danger);
    message.classList.toggle('visually-hidden', appearing);
    message.hidden = text === null;
    message.textContent = appearing ? '' : (text ?? '');
    if (!appearing) return;
    window.setTimeout(() => {
      if (turn !== said) return;
      message.classList.remove('visually-hidden');
      message.textContent = text;
    }, SAY_DELAY_MS);
  }

  /**
   * Each app's link turns sync off there if this device turned it on from
   * here (with this account), and on otherwise.
   */
  async function showSyncApps(): Promise<void> {
    const current = account;
    if (!current) return;
    const synced = syncedApps(current.code);
    // Apps here still on a replaced key: until they're turned on again, a
    // lost device with that key can still see their changes.
    const oldCodes = await Promise.all(replacedSecrets().map((old) => accountCodeOf(old)));
    const stillOld = new Set(oldCodes.flatMap((code) => [...syncedApps(code).keys()]));
    const here = new URL(location.href);
    const links = await Promise.all(
      syncLinks.map(async ({ slug, name, turnOn }) => {
        const origin = synced.get(slug);
        if (!origin || !isAppOrigin(origin, slug, here)) {
          const text = stillOld.has(slug)
            ? `Turn on sync in ${name} again (it’s still on the old key)`
            : `Turn on sync in ${name}`;
          return { text, href: turnOn, off: false };
        }
        const proof = await turnOffProof(await appSecretOf(current.secret, slug));
        return { text: `Turn off sync in ${name}`, href: turnOffUrl(origin, proof), off: true };
      }),
    );
    if (account !== current) return;
    syncLinks.forEach(({ link }, index) => {
      const shown = links[index];
      if (!shown) return;
      link.textContent = shown.text;
      link.href = shown.href;
      link.toggleAttribute('data-turns-off', shown.off);
    });
  }

  /** Forgets the new key shown to save, which the person didn't confirm. */
  function dropPending(): void {
    pending = null;
    newKey.textContent = '';
    newStatus.textContent = '';
  }

  function show(view: View, focus = true): void {
    // A new key goes with its view, however that's left: kept, it was what
    // "Show recovery key" downloaded and copied later (audit 6 A-1).
    if (view !== 'new') dropPending();
    for (const element of views) element.hidden = element.dataset['view'] !== view;
    if (view === 'signed-in' && account) {
      accountCode.textContent = account.code;
      void showSyncApps();
    }
    if (focus) root.querySelector<HTMLElement>(`[data-view="${view}"] [tabindex="-1"]`)?.focus();
    holdAccept();
  }

  function home(focus = true): void {
    if (account && connecting && connecting !== 'invalid') {
      connectCode.textContent = account.code;
      show('connect', focus);
    } else {
      show(account ? 'signed-in' : 'signed-out', focus);
    }
  }

  const STORAGE_BLOCKED =
    'This browser won’t save the account. Is it in private mode, or is storage blocked?';

  /**
   * Signs in with `secret`, unless it was replaced (`replaced` is the message
   * then; null for a new account, which can't be). Returns true if signed in.
   */
  async function signIn(
    secret: Uint8Array<ArrayBuffer>,
    done: string,
    replaced: string | null = REPLACED.key,
  ): Promise<boolean> {
    // Only this device's own key is remembered as replaced (in noteReplaced):
    // a key from someone else's link mustn't bring their data into this account.
    if (replaced !== null && (await wasReplaced(secret))) {
      say(replaced, true);
      return false;
    }
    if (!(await saveAccount(secret))) {
      say(STORAGE_BLOCKED, true);
      return false;
    }
    keepData();
    account = await currentAccount();
    void dropLink();
    home();
    say(done);
    return true;
  }

  /** Shows a new recovery key to save, for a new account or to replace this one. */
  async function showNewKey(replacing: boolean): Promise<void> {
    say(null);
    const secret = generateSecret();
    pending = {
      secret,
      key: await recoveryKeyOf(secret),
      code: await accountCodeOf(secret),
      replacing,
    };
    newTitle.textContent = replacing ? 'Save your new recovery key' : 'Save your recovery key';
    finishLabel.textContent = replacing ? 'Replace the key' : 'Continue';
    replaceOnly.hidden = !replacing;
    newKey.textContent = pending.key;
    newStatus.textContent = '';
    savedCheck.checked = false;
    finishCreate.disabled = true;
    show('new');
  }

  /** Downloads a recovery key file. */
  function downloadKey(key: string, code: string, status: HTMLElement): void {
    downloadFile('shkriuss-recovery-key.txt', recoveryFile(key, code), 'text/plain');
    // The page can't tell when the browser has saved it (audit 5 Z-2).
    status.textContent = 'Download started. Keep the file somewhere safe.';
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
    // "Show a code" takes the code's place: focus goes with it (audit G-5).
    const hadFocus = linkPanel.contains(document.activeElement);
    window.clearInterval(poll);
    poll = undefined;
    link = null;
    linkPanel.hidden = true;
    linkQr.replaceChildren();
    linkUrl.textContent = '';
    createLinkButton.hidden = false;
    if (hadFocus) createLinkButton.focus();
  }

  /**
   * Stops showing the code, and makes it stop working: hiding it isn't
   * enough, as someone may have seen or photographed it (audit A-2). If that
   * doesn't work at once, it keeps trying until the code expires, and says so
   * if someone used it meanwhile.
   */
  async function dropLink(): Promise<void> {
    const shown = link;
    stopLink();
    if (!shown) return;
    let told = false;
    const cancel = async (): Promise<boolean> => {
      try {
        if ((await cancelLink(shown)) === 'used' && !told) {
          told = true;
          say(LINK_USED, true);
        }
        return true;
      } catch {
        return Date.now() > shown.expiresAt;
      }
    };
    if (await cancel()) return;
    const retry = window.setInterval(() => {
      void cancel().then((done) => {
        if (done) window.clearInterval(retry);
      });
    }, LINK_POLL_MS);
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
      linkStatus.textContent = LINK_USED;
    } else if (state === 'expired' || Date.now() > shown.expiresAt) {
      // Cancelled too: by the server's clock, it may still work a moment
      // longer, and hidden it mustn't (audit 6 A-1).
      void dropLink();
      linkStatus.textContent = 'The code expired. Show a new one if you still need it.';
    }
  }

  async function startLink(): Promise<void> {
    if (!account) return;
    void dropLink();
    setBusy(createLinkButton, true);
    linkStatus.textContent = 'Making a code…';
    try {
      link = await createLink(account.secret);
    } catch (error) {
      linkStatus.textContent = problemOf(error);
      return;
    } finally {
      setBusy(createLinkButton, false);
    }
    renderQrCode(linkQr, link.url, 'QR code to add another device to your account');
    linkUrl.textContent = link.url;
    linkPanel.hidden = false;
    // The code takes the button's place: focus goes with it, to "Copy link".
    const hadFocus = document.activeElement === createLinkButton;
    createLinkButton.hidden = true;
    if (hadFocus) copyLinkButton.focus();
    linkStatus.textContent = `Waiting for your other device. The code works once, until ${timeFormat.format(link.expiresAt)}, or until you tap Done.`;
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

  /**
   * "Add this device" and "Turn on sync for …" work only once their
   * question has been on screen, in a window that has focus, for half a
   * second: another website can bring either up (a link; an app opened with
   * "#sync=connect"), and a press sooner may be the second half of a
   * double-click it asked for, closing its own window over this one in
   * between ("DoubleClickjacking", audit 4 C-6, audit 6 A-2). Meanwhile
   * they're marked busy, not disabled: keyboard focus stays on them when the
   * person comes back from another window (audit G-7).
   */
  const confirmations = [acceptLinkButton, acceptConnectButton];
  let acceptTimer: number | undefined;
  /** "Turn on sync for …" was pressed: it stays busy while the page goes back to the app. */
  let leaving = false;
  function holdAccept(): void {
    window.clearTimeout(acceptTimer);
    for (const button of confirmations) setBusy(button, true);
    const shown = confirmations.find((button) => !button.closest('[hidden]'));
    if (!shown || leaving || !document.hasFocus()) return;
    acceptTimer = window.setTimeout(() => {
      setBusy(shown, false);
    }, ACCEPT_DELAY_MS);
  }
  window.addEventListener('focus', holdAccept);
  window.addEventListener('blur', holdAccept);

  // ---------- Passkeys ----------

  const support = await passkeySupport();
  if (support === 'no') {
    for (const element of root.querySelectorAll<HTMLElement>('[data-needs-passkey]')) {
      element.hidden = true;
    }
    passkeyStatus.textContent = 'This browser can’t use passkeys. Use your recovery key instead.';
  }

  /** Runs `task` with `button` busy: presses do nothing meanwhile, and focus stays on it (audit G-7). */
  async function withButton<T>(button: HTMLButtonElement, task: () => Promise<T>): Promise<T> {
    setBusy(button, true);
    try {
      return await task();
    } finally {
      setBusy(button, false);
    }
  }

  // ---------- Actions ----------

  const actions: Record<string, (button: HTMLButtonElement) => void | Promise<void>> = {
    create: () => showNewKey(false),
    'finish-create': async (button) => {
      if (!pending) return;
      const { secret, replacing } = pending;
      if (!replacing) {
        dropPending();
        await signIn(secret, 'Your account is ready, and this device is signed in.', null);
        return;
      }
      if (!account) return;
      const current = account;
      newStatus.textContent = 'Replacing the key…';
      let result: { saved: boolean; noted: boolean };
      try {
        result = await withButton(button, () => replaceAccountKey(current.secret, secret));
      } catch (error) {
        newStatus.textContent = problemOf(error);
        return;
      }
      dropPending();
      account = await currentAccount();
      void dropLink();
      linkStatus.textContent = '';
      home();
      if (!result.saved) say(STORAGE_BLOCKED, true);
      else say(result.noted ? REPLACED.done : REPLACED.unnoted, !result.noted);
    },
    replace: () => {
      say(null);
      show('replace');
    },
    'start-replace': () => showNewKey(true),
    // "Save your recovery key": the new key.
    'download-key': () => {
      if (pending) downloadKey(pending.key, pending.code, newStatus);
    },
    'copy-key': async () => {
      if (pending) await copy(pending.key, newStatus);
    },
    // "Your recovery key": this account's, whatever else the page holds (audit 6 A-1).
    'download-account-key': async () => {
      if (account) downloadKey(await recoveryKeyOf(account.secret), account.code, dialogStatus);
    },
    'copy-account-key': async () => {
      if (account) await copy(await recoveryKeyOf(account.secret), dialogStatus);
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
      linked = null;
      home();
    },
    'passkey-sign-in': (button) =>
      withButton(button, async () => {
        say(null);
        try {
          await signIn(await signInWithPasskey(), 'Signed in with your passkey.', REPLACED.passkey);
        } catch (error) {
          say(problemOf(error), !(error instanceof AccountError && error.code === 'cancelled'));
        }
      }),
    'accept-connect': async (button) => {
      if (!account || !connecting || connecting === 'invalid') return;
      if (button.ariaDisabled === 'true') return;
      // Stays busy: the page goes back to the app.
      leaving = true;
      setBusy(button, true);
      const { request, app } = connecting;
      try {
        const secret = await appSecretOf(account.secret, app.slug);
        // Apps also get their keys from replaced account keys, to move their old copies.
        const replaces = await Promise.all(
          replacedSecrets().map((old) => appSecretOf(old, app.slug)),
        );
        const result = await sealForApp(request, { secret, code: account.code, replaces });
        noteSyncOn(app.slug, account.code, request.from);
        location.replace(connectResultUrl(request.from, result));
      } catch {
        // Not expected (the request was checked), but never a button stuck busy (audit 5 A-3).
        leaving = false;
        setBusy(button, false);
        say(CONNECT_BROKEN, true);
      }
    },
    'cancel-connect': () => {
      if (!connecting || connecting === 'invalid') return;
      location.replace(connectResultUrl(connecting.request.from, 'cancelled'));
    },
    'accept-link': async () => {
      if (!linked || acceptLinkButton.ariaDisabled === 'true') return;
      const secret = linked;
      linked = null;
      await signIn(secret, 'This device is now signed in to your account.');
    },
    'create-link': () => startLink(),
    'close-link': () => {
      void dropLink();
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
      // Apps keep their own keys: signing out here doesn't stop them syncing.
      const synced = account ? syncedApps(account.code) : new Map<string, string>();
      const names = syncLinks.filter(({ slug }) => synced.has(slug)).map(({ name }) => name);
      signOutApps.hidden = names.length === 0;
      signOutAppNames.textContent = names.join(', ');
      // Read out with the question, only while it's shown (a hidden paragraph
      // named this way would be read out too: audit 5 G-3).
      signOutDialog.setAttribute(
        'aria-describedby',
        names.length === 0 ? 'sign-out-description' : 'sign-out-description sign-out-apps',
      );
      signOutDialog.returnValue = '';
      signOutDialog.showModal();
    },
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    const action = button && actions[button.dataset['action'] ?? ''];
    if (button && action) void action(button);
    // "Turn off sync in …": the app turns it off as it opens. (The link
    // itself mustn't change before it opens; see "pageshow".)
    const turnOff = (event.target as Element).closest<HTMLAnchorElement>('a[data-turns-off]');
    if (turnOff) noteSyncOff(turnOff.dataset['syncApp'] ?? '');
  });

  // Back from an app to this page as it was left: show what changed there.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void showSyncApps();
  });
  // Back on screen: the "Turn off sync in …" links are made for the day, so
  // a page left open gets fresh ones (audit 5 A-5).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void showSyncApps();
  });

  savedCheck.addEventListener('change', () => {
    finishCreate.disabled = !savedCheck.checked;
  });

  recoveryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    // Busy while the account service is asked whether the key was replaced,
    // saying so: a second press meanwhile does nothing (audit 4 G-6).
    if (recoverySubmit.ariaDisabled === 'true') return;
    void withButton(recoverySubmit, async () => {
      const result = await parseRecoveryKey(recoveryInput.value);
      if (!result.ok) {
        recoveryError.textContent =
          result.problem === 'format'
            ? 'That isn’t a recovery key. It has 56 letters and digits, in groups of 4.'
            : 'There’s a mistake in it. Check each group against your saved key.';
        recoveryInput.setAttribute('aria-invalid', 'true');
        focusProblem(recoveryInput, recoveryError.textContent ?? '');
        return;
      }
      say('Signing in…');
      if (await signIn(result.secret, 'Signed in with your recovery key.')) {
        recoveryInput.value = '';
      } else {
        recoveryInput.focus();
      }
    });
  });

  keyDialog.addEventListener('close', () => {
    dialogKey.textContent = '';
  });

  signOutDialog.addEventListener('close', () => {
    if (signOutDialog.returnValue !== 'confirm') return;
    forgetAccount();
    account = null;
    void dropLink();
    linkStatus.textContent = '';
    show('signed-out');
    say('This device is signed out.');
  });

  // Signed in or out, or an app connected, in another tab: follow along.
  window.addEventListener('storage', (event) => {
    if (event.key === 'shkriuss-device:synced-apps') {
      void showSyncApps();
      return;
    }
    if (event.key !== null && event.key !== 'shkriuss-device:account') return;
    void currentAccount().then((current) => {
      const before = account;
      account = current;
      // Another account now, or none: what's open about the one before goes,
      // its recovery key above all, and the page says why (audit 4 G-4). Its
      // code to add a device stops working, and a key replacement started
      // for it can't go on to replace the new account's key.
      const changed = before?.code !== current?.code;
      if (changed) {
        void dropLink();
        linkStatus.textContent = '';
        if (pending?.replacing) dropPending();
        if (keyDialog.open) keyDialog.close();
        if (signOutDialog.open) signOutDialog.close();
        say(
          !current
            ? 'This device was signed out in another tab.'
            : before
              ? 'The account on this device changed in another tab.'
              : 'This device was signed in, in another tab.',
        );
      }
      // Asked whether to add this device: says whether it would replace an account.
      linkReplace.hidden = !account;
      if (pending || linked) return;
      home(false);
      // Focus that was in what's now hidden goes to the top of what's shown.
      const active = document.activeElement;
      if (changed && (!active || active === document.body || active.closest('[hidden]'))) {
        root.querySelector<HTMLElement>('[data-view]:not([hidden]) [tabindex="-1"]')?.focus();
      }
    });
  });

  window.addEventListener('hashchange', () => void openLink(location.hash));

  // Replaced here, but the answer never came (the connection dropped, or
  // the page was closed): finished now, as if it had (audit 6 A-1).
  const finished = account ? await finishReplacing(account) : null;
  if (finished) account = await currentAccount();

  // Replaced on another device (a lost device): signed out here, keeping
  // nothing of it, as "Sign out" does (audit 3 D-8). Its apps here keep
  // their own keys: the message names them, now that the list is gone.
  const stillSyncing = account ? await signOutIfReplaced(account) : null;
  if (stillSyncing) {
    account = null;
    const names = syncLinks.filter(({ slug }) => stillSyncing.includes(slug));
    say(replacedHere(names.map(({ name }) => name)), true);
  } else if (finished) {
    say(finished.saved ? REPLACED.done : STORAGE_BLOCKED, !finished.saved);
  }
  // The account key, and the replaced keys the apps need, are only in this
  // browser: it's asked not to delete them when it's short of space, as
  // each app asks after its first save (keepData; signIn asks too). The hub
  // didn't (audit 6 E-6).
  if (account) keepData();

  if (!(await openLink(location.hash))) home(false);
}
