export type AccountErrorCode =
  /** The person closed the passkey prompt, or took too long. */
  | 'cancelled'
  /** This browser or password manager can't make passkeys that unlock accounts. */
  | 'no-prf'
  /** No account is connected to the passkey that was used. */
  | 'unknown-passkey'
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

/** Calls the account service on this site. Network failures become AccountError("server"). */
export async function api(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  try {
    return await fetch(`/api/account${path}`, { ...init, headers, credentials: 'omit' });
  } catch {
    throw new AccountError('server', 'Couldn’t reach the account service.');
  }
}
