/**
 * The account service on the hub (docs/adr/0010). It holds two kinds of
 * things, both already encrypted on the device:
 *
 * - Device links: a device that's signed in puts the account secret here,
 *   sealed with a one-time key that only goes into the QR code. The other
 *   device fetches it once. After 10 minutes, or once used, it's deleted.
 * - Passkey locks: the account secret sealed with a key that only a passkey
 *   can produce (WebAuthn PRF). Found by a lookup token from the same
 *   passkey, of which the server keeps only the SHA-256 hash.
 *
 *   GET    /api/account/ping             is the service running?
 *   PUT    /api/account/link/<id>        store a link (once)
 *   GET    /api/account/link/<id>        fetch it (once; then it's deleted)
 *   GET    /api/account/link/<id>/state  "waiting", "used" or "expired"
 *   PUT    /api/account/passkey          store a passkey lock (Bearer: lookup token)
 *   GET    /api/account/passkey          fetch it
 *   DELETE /api/account/passkey          delete it
 *
 * There are no account ids, names, emails or passwords: nothing here can be
 * linked to a person, or to the data in any app.
 */
import {
  bearerToken,
  createWorker,
  json,
  jsonBody,
  noContent,
  problem,
  sha256Text,
  type DurableObjectNamespace,
  type DurableObjectState,
  type SiteEnv,
} from '@shkriuss/server';
import {
  checkSealedBody,
  LINK_ID_PATTERN,
  LINK_LIFETIME_MS,
  MAX_REQUEST_BYTES,
} from './validate.ts';

export interface AccountEnv extends SiteEnv {
  ACCOUNT_LINKS: DurableObjectNamespace;
  ACCOUNT_PASSKEYS: DurableObjectNamespace;
}

/** Requests to /api/account/*. */
export async function handleAccount(
  request: Request,
  env: AccountEnv,
  path: string,
): Promise<Response> {
  if (path === '/api/account/ping') return json({ ok: true });

  const link = /^\/api\/account\/link\/([^/]+)(\/state)?$/.exec(path);
  if (link) {
    const [, id = '', state] = link;
    if (!LINK_ID_PATTERN.test(id)) return problem(404, 'Not found.');
    const stub = env.ACCOUNT_LINKS.get(env.ACCOUNT_LINKS.idFromName(id));
    if (state) {
      if (request.method !== 'GET') return problem(405, 'Use GET.');
      return stub.fetch('https://link/state');
    }
    if (request.method === 'GET') return stub.fetch('https://link/claim');
    if (request.method !== 'PUT') return problem(405, 'Use PUT or GET.');
    const read = await jsonBody(request, MAX_REQUEST_BYTES);
    if (!read.ok) return read.response;
    const checked = checkSealedBody(read.body, 'data');
    if (!checked.ok) return problem(400, checked.error);
    return stub.fetch('https://link/', { method: 'PUT', body: checked.value });
  }

  if (path === '/api/account/passkey') {
    const lookup = bearerToken(request);
    if (!lookup) return problem(401, 'Missing or malformed lookup token.');
    const stub = env.ACCOUNT_PASSKEYS.get(
      env.ACCOUNT_PASSKEYS.idFromName(await sha256Text(lookup)),
    );
    if (request.method === 'GET') return stub.fetch('https://passkey/');
    if (request.method === 'DELETE') return stub.fetch('https://passkey/', { method: 'DELETE' });
    if (request.method !== 'PUT') return problem(405, 'Use GET, PUT or DELETE.');
    const read = await jsonBody(request, MAX_REQUEST_BYTES);
    if (!read.ok) return read.response;
    const checked = checkSealedBody(read.body, 'wrap');
    if (!checked.ok) return problem(400, checked.error);
    return stub.fetch('https://passkey/', { method: 'PUT', body: checked.value });
  }

  return problem(404, 'Not found.');
}

export default createWorker<AccountEnv>({ '/api/account': handleAccount });

// ---------- One device link ----------

interface LinkRecord {
  /** The sealed secret, until it's fetched. */
  data: string | null;
  expiresAt: number;
}

export class AccountLink {
  readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    // One request at a time, so a link can't be fetched twice.
    return this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const saved = await this.state.storage.get<LinkRecord>('link');
      const record = saved && saved.expiresAt > now ? saved : undefined;

      if (request.method === 'PUT') {
        if (saved) return problem(409, 'This link already exists.');
        const expiresAt = now + LINK_LIFETIME_MS;
        await this.state.storage.put('link', { data: await request.text(), expiresAt });
        await this.state.storage.setAlarm(expiresAt);
        return json({ expiresAt }, 201);
      }

      if (pathname === '/state') {
        return json({ state: !record ? 'expired' : record.data === null ? 'used' : 'waiting' });
      }

      // Fetch it, once.
      if (!record) return problem(410, 'This link has expired.');
      if (record.data === null) return problem(410, 'This link was already used.');
      await this.state.storage.put('link', { data: null, expiresAt: record.expiresAt });
      return json({ data: record.data });
    });
  }

  /** At expiry: delete everything. */
  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

// ---------- One passkey lock ----------

export class AccountPasskey {
  readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'PUT') {
      await this.state.storage.put('wrap', await request.text());
      return noContent();
    }
    if (request.method === 'DELETE') {
      await this.state.storage.deleteAll();
      return noContent();
    }
    const wrap = await this.state.storage.get<string>('wrap');
    return wrap ? json({ wrap }) : problem(404, 'No account is connected to this passkey.');
  }
}
