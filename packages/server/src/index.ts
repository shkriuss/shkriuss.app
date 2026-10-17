/**
 * Shared helpers for the small server part of a site (its own Worker).
 *
 * A site with server routes has apps/<slug>/src/worker.ts, which builds its
 * Worker with createWorker(): requests to /api/<feature>/* go to that
 * feature's handler, and everything else is the site's static files, served
 * as before. Features: notifications (@shkriuss/push), the account on the hub
 * (@shkriuss/account).
 */
import { toBase64Url, sha256, utf8 } from '@shkriuss/crypto';

// ---------- The small part of the Workers runtime we use ----------

export interface DurableObjectId {
  toString(): string;
}
export interface DurableObjectStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
export interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
export interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

/** Every site's static files (the "ASSETS" binding in wrangler.jsonc). */
export interface SiteEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// ---------- Responses ----------

/** Sent with every API response (the static files get theirs from _headers). */
export const API_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...API_HEADERS },
  });
}

export const problem = (status: number, error: string): Response => json({ error }, status);

export const noContent = (): Response => new Response(null, { status: 204, headers: API_HEADERS });

// ---------- Requests ----------

/** SHA-256 of a string, base64url. Used to store keys' hashes, never the keys. */
export async function sha256Text(text: string): Promise<string> {
  return toBase64Url(await sha256(utf8(text)));
}

/** A random key sent as "Authorization: Bearer <key>": 32 bytes, base64url (43 characters). */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization') ?? '');
  return match?.[1] ?? null;
}

/** Reads a JSON body, refusing anything bigger than `limit` bytes (throws RangeError). */
export async function readJson(request: Request, limit: number): Promise<unknown> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > limit) throw new RangeError('Too big');
  const text = await request.text();
  if (text.length > limit) throw new RangeError('Too big');
  return JSON.parse(text);
}

/** readJson() as a response: the parsed body, or the 413/400 to send back. */
export async function jsonBody(
  request: Request,
  limit: number,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await readJson(request, limit) };
  } catch (error) {
    return {
      ok: false,
      response:
        error instanceof RangeError
          ? problem(413, 'Request too big.')
          : problem(400, 'Body must be JSON.'),
    };
  }
}

/**
 * True for requests a browser made from another site or subdomain. Our own
 * pages never do that, so they're refused (browsers mark every request with
 * Sec-Fetch-Site; other clients don't send it).
 */
export function isFromAnotherSite(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  return site !== null && site !== 'same-origin' && site !== 'none';
}

// ---------- The Worker ----------

/** Answers one feature's requests; `path` is the URL path, e.g. "/api/push/key". */
export type ApiHandler<Env> = (request: Request, env: Env, path: string) => Promise<Response>;

/**
 * A site's Worker: `routes` maps a path prefix such as "/api/push" to its
 * handler. Other /api/ paths are 404; everything else is a static file.
 */
export function createWorker<Env extends SiteEnv>(
  routes: Readonly<Record<string, ApiHandler<Env>>>,
) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      const prefix = Object.keys(routes).find(
        (route) => pathname === route || pathname.startsWith(`${route}/`),
      );
      const handler = prefix === undefined ? undefined : routes[prefix];
      if (!handler) return problem(404, 'Not found.');
      if (isFromAnotherSite(request)) return problem(403, 'Requests must come from this site.');
      try {
        return await handler(request, env, pathname);
      } catch {
        // Never echo details: they could include someone's data.
        return problem(500, 'Something went wrong.');
      }
    },
  };
}
