/**
 * The account service on the hub (docs/adr/0010). It holds two kinds of
 * things, both already encrypted on the device:
 *
 * - Device links: a device that's signed in puts the account secret here,
 *   sealed with a one-time key that only goes into the QR code. The other
 *   device fetches it once. After 10 minutes, or once used, it's deleted.
 *   Every link is a row in one object (LINKS), which deletes the expired
 *   ones at each request, so a dropped alarm can't leave one behind.
 * - Passkey locks: the account secret sealed with a key that only a passkey
 *   can produce (WebAuthn PRF). Found by a lookup token from the same
 *   passkey, of which the server keeps only the SHA-256 hash. Each lock
 *   keeps the passkey's public key too, and is only given out (or removed)
 *   for the passkey's signature made on the Account page itself
 *   (docs/adr/0018, ./webauthn.ts): other pages can use the passkey too.
 * - Replaced keys: after someone replaces their account key (a lost device),
 *   a note that the old one was replaced, so devices still holding it sign
 *   out. Found by the hash of a token only the old key can make.
 *
 *   GET    /api/account/ping             is the service running?
 *   PUT    /api/account/link/<id>        store a link (once), with a token that cancels it
 *   GET    /api/account/link/<id>        fetch it (once; then it's deleted)
 *   DELETE /api/account/link/<id>        cancel it (Bearer: that token), unless it was used
 *   GET    /api/account/link/<id>/state  "waiting", "used" or "expired"
 *   PUT    /api/account/passkey          store a passkey lock (Bearer: lookup token), with
 *                                        the passkey's public key and a signature
 *   POST   /api/account/passkey/open     { assertion }: fetch the lock
 *   POST   /api/account/passkey/remove   { assertion }: delete it
 *   GET    /api/account/status           { replaced, successor? } (Bearer: status token)
 *   PUT    /api/account/status           mark this key as replaced (for good), with
 *                                        { successor }: a tag of the key that replaced it
 *
 * There are no account ids, names, emails or passwords: nothing here can be
 * linked to a person, or to the data in any app.
 *
 * Anyone can make up a lookup or status token, so all passkey locks
 * together, and all replaced-key notes together, have a limit
 * (STORAGE_LIMITS, kept by each namespace's meter: @shkriuss/server/meter),
 * and a note nobody has asked about for about 13 months is deleted
 * (docs/adr/0017-storage-limits.md). Device links go after 10 minutes
 * anyway, and all of them together are one small object.
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
  type DurableObjectListState,
  type DurableObjectNamespace,
  type DurableObjectState,
  type SiteEnv,
} from '@shkriuss/server';
import { equalBytes, utf8 } from '@shkriuss/crypto';
import { LIMIT_HEADER, limitOf, METER, meterFetch, release, reserve } from '@shkriuss/server/meter';
import {
  checkAssertionShape,
  checkLinkBody,
  checkNewLock,
  LINK_ID_PATTERN,
  LINK_LIFETIME_MS,
  MAX_PASSKEY_REQUEST_BYTES,
  MAX_REQUEST_BYTES,
  REPLACED_NOTE_MS,
  SUCCESSOR_PATTERN,
} from './validate.ts';
import { checkAssertion, type Assertion, type PasskeyKey, type Purpose } from './webauthn.ts';

/** From the Worker to the links' object: the hash of the token that cancels a link. */
const CANCEL_HEADER = 'X-Shkriuss-Cancel';

/** The one object that holds every device link (AccountLink). */
export const LINKS = 'links';

export interface AccountEnv extends SiteEnv {
  ACCOUNT_LINKS: DurableObjectNamespace;
  ACCOUNT_PASSKEYS: DurableObjectNamespace;
  ACCOUNT_STATUS: DurableObjectNamespace;
  /**
   * Only for local browser tests: the Account page's address, which passkey
   * signatures must come from. Locally, the Worker sees its own address as
   * the real site's; on Cloudflare it's the real one, so this isn't set.
   */
  ACCOUNT_ORIGIN?: string;
}

/**
 * All passkey locks together, and all replaced-key notes together, in bytes.
 * Each counts 16 KB (it holds less).
 */
export const STORAGE_LIMITS = { passkeys: 40_000_000, replaced: 40_000_000 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A replaced-key note nobody has asked about for this long (about 13 months)
 * is deleted. The device that replaced the key forgets it after as long
 * (./device.ts), so no app gets it once the note may be gone.
 */
export const UNUSED_MS = REPLACED_NOTE_MS;

/** A namespace's limit, for the object to check. */
const limitHeaders = (limit: number) => ({ [LIMIT_HEADER]: String(limit) });

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
    // Every link is in the one object (audit 5 B-2).
    const stub = env.ACCOUNT_LINKS.get(env.ACCOUNT_LINKS.idFromName(LINKS));
    if (state) {
      if (request.method !== 'GET') return problem(405, 'Use GET.');
      return stub.fetch(`https://link/${id}/state`);
    }
    if (request.method === 'GET') return stub.fetch(`https://link/${id}/claim`);
    if (request.method === 'DELETE') {
      const cancel = bearerToken(request);
      if (!cancel) return problem(401, 'Missing or malformed cancel token.');
      return stub.fetch(`https://link/${id}`, {
        method: 'DELETE',
        headers: { [CANCEL_HEADER]: await sha256Text(cancel) },
      });
    }
    if (request.method !== 'PUT') return problem(405, 'Use PUT, GET or DELETE.');
    const read = await jsonBody(request, MAX_REQUEST_BYTES);
    if (!read.ok) return read.response;
    const checked = checkLinkBody(read.body);
    if (!checked.ok) return problem(400, checked.error);
    const { data, cancel } = checked.value;
    const body = { data, cancel: cancel === null ? null : await sha256Text(cancel) };
    return stub.fetch(`https://link/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  }

  const passkey = /^\/api\/account\/passkey(?:\/(open|remove))?$/.exec(path);
  if (passkey) {
    const [, action] = passkey;
    const lookup = bearerToken(request);
    if (!lookup) return problem(401, 'Missing or malformed lookup token.');
    const purpose: Purpose = action === 'open' ? 'open' : action === 'remove' ? 'remove' : 'add';
    const method = purpose === 'add' ? 'PUT' : 'POST';
    // GET and DELETE were for pages from before signatures were checked: reloading updates them.
    if (request.method !== method) return problem(405, `Use ${method}.`);
    const read = await jsonBody(request, MAX_PASSKEY_REQUEST_BYTES);
    if (!read.ok) return read.response;
    let body: PasskeyRequest;
    // The page the signature must come from: the Account page, at this site's own address.
    const origin = new URL(env.ACCOUNT_ORIGIN ?? request.url);
    const expected = { origin: origin.origin, rpId: origin.hostname, purpose };
    if (purpose === 'add') {
      const checked = checkNewLock(read.body);
      if (!checked.ok) return problem(400, checked.error);
      const { wrap, key, assertion } = checked.value;
      body = { expected, assertion, lock: { wrap, ...key } };
    } else {
      const fields = read.body as { assertion?: unknown } | null;
      if (typeof fields !== 'object' || fields === null || Object.keys(fields).length !== 1) {
        return problem(400, 'Body must be { "assertion": {…} }.');
      }
      const checked = checkAssertionShape(fields.assertion);
      if (!checked.ok) return problem(400, checked.error);
      body = { expected, assertion: checked.value };
    }
    const stub = env.ACCOUNT_PASSKEYS.get(
      env.ACCOUNT_PASSKEYS.idFromName(await sha256Text(lookup)),
    );
    return stub.fetch('https://passkey/', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: limitHeaders(STORAGE_LIMITS.passkeys),
    });
  }

  if (path === '/api/account/status') {
    const token = bearerToken(request);
    if (!token) return problem(401, 'Missing or malformed status token.');
    const stub = env.ACCOUNT_STATUS.get(env.ACCOUNT_STATUS.idFromName(await sha256Text(token)));
    if (request.method === 'GET') return stub.fetch('https://status/');
    if (request.method === 'PUT') {
      // { successor } (devices before it was added send no body).
      let successor: string | null = null;
      if (request.headers.get('Content-Type')?.includes('application/json')) {
        const read = await jsonBody(request, MAX_REQUEST_BYTES);
        if (!read.ok) return read.response;
        const value = (read.body as { successor?: unknown } | null)?.successor;
        if (typeof value !== 'string' || !SUCCESSOR_PATTERN.test(value)) {
          return problem(400, 'Body must be { "successor": "…" }.');
        }
        successor = value;
      }
      return stub.fetch('https://status/', {
        method: 'PUT',
        body: JSON.stringify({ successor }),
        headers: limitHeaders(STORAGE_LIMITS.replaced),
      });
    }
    return problem(405, 'Use GET or PUT.');
  }

  return problem(404, 'Not found.');
}

export default createWorker<AccountEnv>({ '/api/account': handleAccount });

// ---------- Device links, all in one object ----------

interface LinkRecord {
  /** The sealed secret, until it's fetched. */
  data: string | null;
  expiresAt: number;
  /** The hash of the token that cancels it (null for links made before that). */
  cancel?: string | null;
}

/** A link's row: "link:<id>". */
const linkKey = (id: string) => `link:${id}`;
/** "due:<expiry>:<id>": the links in the order they expire, for the sweep. */
const dueKey = (expiresAt: number, id: string) =>
  `due:${String(expiresAt).padStart(16, '0')}:${id}`;
/** Expired links looked at in one go (a few hundred are alive at most). */
const SWEEP_BATCH = 128;

/**
 * Every device link, as a row in the one object named LINKS, with one alarm
 * at the earliest expiry. Each request first deletes the links that have
 * expired (#sweep), so a junk link is a row of a few hundred bytes that
 * outlives its 10 minutes only until the next request, even when Cloudflare
 * dropped the alarm (it gives up after a few tries once the day's free
 * writes are used up, which a script making links uses up itself). Before,
 * each link was an object of its own, deleted only by its own alarm: 12 KB
 * that no meter counted, for good (audit 5 B-2).
 */
export class AccountLink {
  readonly state: DurableObjectListState;

  constructor(state: DurableObjectListState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const [, id = '', action] = /^\/([^/]+)(?:\/(state|claim))?$/.exec(pathname) ?? [];
    // One request at a time, so a link can't be fetched twice.
    return this.state.blockConcurrencyWhile(async () => {
      const storage = this.state.storage;
      const now = Date.now();
      await this.#sweep(now);
      const record = await storage.get<LinkRecord>(linkKey(id));

      if (request.method === 'PUT') {
        if (record) return problem(409, 'This link already exists.');
        const expiresAt = now + LINK_LIFETIME_MS;
        const { data, cancel } = (await request.json()) as { data: string; cancel: string | null };
        await storage.put(linkKey(id), { data, expiresAt, cancel } satisfies LinkRecord);
        await storage.put(dueKey(expiresAt, id), true);
        // The alarm is for the earliest expiry; this link's is the latest.
        if ((await storage.getAlarm()) === null) await storage.setAlarm(expiresAt);
        return json({ expiresAt }, 201);
      }

      // Cancelled by the device that made it ("Done"): it stops working at once.
      if (request.method === 'DELETE') {
        if (!record) return noContent();
        // Hashes of the token, compared in constant time as every secret is (audit 6 A-2).
        const given = utf8(request.headers.get(CANCEL_HEADER) ?? '');
        if (!record.cancel || !equalBytes(utf8(record.cancel), given)) {
          return problem(403, 'Only the device that made this link can cancel it.');
        }
        if (record.data === null) {
          return json({ error: 'This link was already used.', used: true }, 409);
        }
        await storage.delete(linkKey(id));
        await storage.delete(dueKey(record.expiresAt, id));
        return noContent();
      }

      if (action === 'state') {
        return json({ state: !record ? 'expired' : record.data === null ? 'used' : 'waiting' });
      }

      // Fetch it, once.
      if (!record) return problem(410, 'This link has expired.');
      if (record.data === null)
        return json({ error: 'This link was already used.', used: true }, 410);
      await storage.put(linkKey(id), { ...record, data: null });
      return json({ data: record.data });
    });
  }

  /** At the earliest expiry: the expired links go, and the alarm moves on. */
  async alarm(): Promise<void> {
    await runAlarm(this.state, async () => {
      // A link made before links shared one object was an object of its own,
      // deleted whole at its expiry: still is, if its alarm runs this code.
      if ((await this.state.storage.get('link')) !== undefined) {
        await this.state.storage.deleteAll();
        return;
      }
      await this.#sweep(Date.now());
    });
  }

  /** Deletes the links that have expired, and plans the next one's end if nothing is planned. */
  async #sweep(now: number): Promise<void> {
    const storage = this.state.storage;
    for (;;) {
      const due = [...(await storage.list({ prefix: 'due:', limit: SWEEP_BATCH })).keys()];
      const expired = due.filter((key) => Number(key.split(':')[1]) <= now);
      for (const key of expired) {
        await storage.delete(linkKey(key.split(':')[2] ?? ''));
        await storage.delete(key);
      }
      if (expired.length < due.length) {
        const next = Number(due[expired.length]?.split(':')[1]);
        if ((await storage.getAlarm()) === null) await storage.setAlarm(next);
        return;
      }
      if (due.length < SWEEP_BATCH) return;
    }
  }
}

// ---------- One passkey lock ----------

/** A lock: the sealed account secret, and the passkey's public key to check signatures with. */
interface Lock extends PasskeyKey {
  wrap: string;
}

/** From the Worker to a lock's object: the signature, where it must come from, and a new lock. */
interface PasskeyRequest {
  expected: { origin: string; rpId: string; purpose: Purpose };
  assertion: Assertion;
  lock?: Lock;
}

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
    const { expected, assertion, lock } = (await request.json()) as PasskeyRequest;
    return this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get<Lock>('lock');
      // Locks from before signatures were checked have no public key: they
      // can't be checked, so they no longer open (the passkey is added again).
      const old = saved === undefined && (await this.state.storage.get('wrap')) !== undefined;
      const refused = () => problem(403, 'This passkey’s signature isn’t from the Account page.');

      if (expected.purpose === 'add') {
        if (!lock) return problem(400, 'No lock.');
        if (saved || old) return problem(409, 'This passkey already has a lock.');
        // Signed with the key being stored: this shows only that whoever adds the
        // lock has that key pair, which a script can make itself. So an existing
        // lock is never replaced (above), and the Account page leaves no passkey
        // without a lock (audit 4 A-2).
        if (!(await checkAssertion(assertion, lock, expected))) return refused();
        if (!(await reserve(this.state, this.env.ACCOUNT_PASSKEYS, 0, limitOf(request)))) {
          return problem(507, 'There’s no room for more passkeys just now.');
        }
        await this.state.storage.put('lock', lock);
        return noContent();
      }
      if (expected.purpose === 'open') {
        if (old) {
          return json({ error: 'This passkey needs to be added again.', old: true }, 410);
        }
        // `unknown`: the browser may forget the passkey (and only then: audit A-4).
        if (!saved) return json({ error: 'No account uses this passkey.', unknown: true }, 404);
        if (!(await checkAssertion(assertion, saved, expected))) return refused();
        return json({ wrap: saved.wrap });
      }
      // Remove: an old lock can't be checked, but can't open either.
      if (!saved && !old) return noContent();
      if (saved && !(await checkAssertion(assertion, saved, expected))) return refused();
      await release(this.state, this.env.ACCOUNT_PASSKEYS);
      await this.state.storage.deleteAll();
      return noContent();
    });
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
        // asked about it for 13 months: by then no device still has it). The
        // first note says which key replaced it; later ones change nothing.
        if (!replaced) {
          if (!(await reserve(this.state, this.env.ACCOUNT_STATUS, 0, limitOf(request)))) {
            return problem(507, 'There’s no room to note the old key just now.');
          }
          const { successor } = (await request.json()) as { successor: string | null };
          await this.state.storage.put('replaced', now);
          if (successor) await this.state.storage.put('successor', successor);
        }
        await this.#touch(now);
        return noContent();
      }
      if (!replaced) return json({ replaced });
      await this.#touch(now);
      const successor = await this.state.storage.get<string>('successor');
      return json(successor ? { replaced, successor } : { replaced });
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
