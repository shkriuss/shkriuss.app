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
 * - Replaced keys: after someone replaces their account key (a lost device),
 *   a note that the old one was replaced, so devices still holding it sign
 *   out. Found by the hash of a token only the old key can make.
 *
 *   GET    /api/account/ping             is the service running?
 *   PUT    /api/account/link/<id>        store a link (once)
 *   GET    /api/account/link/<id>        fetch it (once; then it's deleted)
 *   GET    /api/account/link/<id>/state  "waiting", "used" or "expired"
 *   PUT    /api/account/passkey          store a passkey lock (Bearer: lookup token)
 *   GET    /api/account/passkey          fetch it
 *   DELETE /api/account/passkey          delete it
 *   GET    /api/account/status           { replaced } (Bearer: status token)
 *   PUT    /api/account/status           mark this key as replaced (for good)
 *
 * There are no account ids, names, emails or passwords: nothing here can be
 * linked to a person, or to the data in any app.
 *
 * Anyone can make up a lookup or status token, so all passkey locks
 * together, and all replaced-key notes together, have a limit
 * (STORAGE_LIMITS, kept by each namespace's meter: @shkriuss/server/meter),
 * and a note nobody has asked about for about 13 months is deleted
 * (docs/adr/0017-storage-limits.md). Device links go after 10 minutes anyway.
 */
import {
  bearerToken,
  createWorker,
  json,
  jsonBody,
  noContent,
  problem,
  runAlarm,
  sha256Text,
  type DurableObjectNamespace,
  type DurableObjectState,
  type SiteEnv,
} from '@shkriuss/server';
import {
  LIMIT_HEADER,
  limitFor,
  limitOf,
  METER,
  meterFetch,
  release,
  reserve,
} from '@shkriuss/server/meter';
import {
  checkSealedBody,
  LINK_ID_PATTERN,
  LINK_LIFETIME_MS,
  MAX_REQUEST_BYTES,
} from './validate.ts';

export interface AccountEnv extends SiteEnv {
  ACCOUNT_LINKS: DurableObjectNamespace;
  ACCOUNT_PASSKEYS: DurableObjectNamespace;
  ACCOUNT_STATUS: DurableObjectNamespace;
}

/**
 * All passkey locks together, and all replaced-key notes together, in bytes,
 * on the real site and on a PR preview. Each counts 16 KB (it holds less).
 */
export const STORAGE_LIMITS = {
  passkeys: { site: 40_000_000, preview: 4_000_000 },
  replaced: { site: 40_000_000, preview: 4_000_000 },
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A replaced-key note nobody has asked about for this long (about 13 months) is deleted. */
export const UNUSED_MS = 396 * DAY_MS;

/** The limit for one namespace on this site, for the object to check. */
const limitHeaders = (request: Request, limits: { site: number; preview: number }) => ({
  [LIMIT_HEADER]: String(limitFor(new URL(request.url), limits)),
});

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
    return stub.fetch('https://passkey/', {
      method: 'PUT',
      body: checked.value,
      headers: limitHeaders(request, STORAGE_LIMITS.passkeys),
    });
  }

  if (path === '/api/account/status') {
    const token = bearerToken(request);
    if (!token) return problem(401, 'Missing or malformed status token.');
    const stub = env.ACCOUNT_STATUS.get(env.ACCOUNT_STATUS.idFromName(await sha256Text(token)));
    if (request.method === 'GET') return stub.fetch('https://status/');
    if (request.method === 'PUT') {
      return stub.fetch('https://status/', {
        method: 'PUT',
        headers: limitHeaders(request, STORAGE_LIMITS.replaced),
      });
    }
    return problem(405, 'Use GET or PUT.');
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
      if (record.data === null)
        return json({ error: 'This link was already used.', used: true }, 410);
      await this.state.storage.put('link', { data: null, expiresAt: record.expiresAt });
      return json({ data: record.data });
    });
  }

  /** At expiry: delete everything. */
  async alarm(): Promise<void> {
    await runAlarm(this.state, () => this.state.storage.deleteAll());
  }
}

// ---------- One passkey lock ----------

export class AccountPasskey {
  readonly state: DurableObjectState;
  readonly env: AccountEnv;

  constructor(state: DurableObjectState, env: AccountEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    // The meter for all passkey locks is one of these objects too, named METER.
    if (new URL(request.url).hostname === METER) return meterFetch(this.state, request);
    if (request.method === 'PUT') {
      if (!(await reserve(this.state, this.env.ACCOUNT_PASSKEYS, 0, limitOf(request)))) {
        return problem(507, 'There’s no room for more passkeys just now.');
      }
      await this.state.storage.put('wrap', await request.text());
      return noContent();
    }
    if (request.method === 'DELETE') {
      await release(this.state, this.env.ACCOUNT_PASSKEYS);
      await this.state.storage.deleteAll();
      return noContent();
    }
    const wrap = await this.state.storage.get<string>('wrap');
    return wrap ? json({ wrap }) : problem(404, 'No account is connected to this passkey.');
  }
}

// ---------- Whether an account key was replaced ----------

export class AccountStatus {
  readonly state: DurableObjectState;
  readonly env: AccountEnv;

  constructor(state: DurableObjectState, env: AccountEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    // The meter for all notes is one of these objects too, named METER.
    if (new URL(request.url).hostname === METER) return meterFetch(this.state, request);
    return this.state.blockConcurrencyWhile(async () => {
      const replaced = (await this.state.storage.get<number>('replaced')) !== undefined;
      const now = Date.now();
      if (request.method === 'PUT') {
        // A replaced key never becomes the account again (until nobody has
        // asked about it for 13 months: by then no device still has it).
        if (!replaced) {
          if (!(await reserve(this.state, this.env.ACCOUNT_STATUS, 0, limitOf(request)))) {
            return problem(507, 'There’s no room to note the old key just now.');
          }
          await this.state.storage.put('replaced', now);
        }
        await this.#touch(now);
        return noContent();
      }
      if (replaced) await this.#touch(now);
      return json({ replaced });
    });
  }

  /** UNUSED_MS after a device last asked: the note goes, and its room with it. */
  async alarm(): Promise<void> {
    await runAlarm(this.state, async () => {
      const active = (await this.state.storage.get<number>('active')) ?? 0;
      if (Date.now() - active < UNUSED_MS) {
        await this.state.storage.setAlarm(active + UNUSED_MS);
        return;
      }
      await release(this.state, this.env.ACCOUNT_STATUS);
      await this.state.storage.deleteAll();
    });
  }

  /** Keeps the note for UNUSED_MS more. At most once a day: each time is a write. */
  async #touch(now: number): Promise<void> {
    const active = await this.state.storage.get<number>('active');
    if (active !== undefined && now - active < DAY_MS) return;
    await this.state.storage.put('active', now);
    await this.state.storage.setAlarm(now + UNUSED_MS);
  }
}
