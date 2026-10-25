export type AccountErrorCode =
  /** The person closed the passkey prompt, or took too long. */
  | 'cancelled'
  /** This browser or password manager can't make passkeys that unlock accounts. */
  | 'no-prf'
  /** No account is connected to the passkey that was used. */
  | 'unknown-passkey'
  /** The passkey was added before the service checked passkeys' signatures: add it again. */
  | 'old-passkey'
  /** The service didn't accept the passkey's signature (a device clock far off, say). */
  | 'passkey-refused'
  /** The device link has expired, or doesn't exist (or doesn't work). */
  | 'link-used'
  /** Someone already used the device link: maybe not the person. */
  | 'link-taken'
  /** The account service couldn't be reached or refused the request. */
  | 'server';

export class AccountError extends Error {
  readonly code: AccountErrorCode;
  constructor(code: AccountErrorCode, message: string) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
  }
}

/**
 * How long the account service may take to answer. Its answers are tiny, so
 * on a network that hangs (a VPN with no connection, captive Wi-Fi) the page
 * says it couldn't reach it, instead of waiting for ever (audit G-11).
 */
export const REQUEST_MS = 20_000;

/** A signal that gives up after `ms` (a timer, so tests can move time on). */
function timeLimit(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(new DOMException('No answer in time', 'TimeoutError'));
  }, ms);
  return controller.signal;
}

/** Calls the account service on this site. Network failures and no answer in time become AccountError("server"). */
export async function api(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  try {
    return await fetch(`/api/account${path}`, {
      ...init,
      headers,
      credentials: 'omit',
      signal: init.signal ?? timeLimit(REQUEST_MS),
    });
  } catch {
    throw new AccountError('server', 'Couldn’t reach the account service.');
  }
}
