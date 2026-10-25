/**
 * Storage meters (docs/adr/0017-storage-limits.md).
 *
 * Cloudflare's free plan has 5 GB of Durable Object storage for every app
 * together, and our objects are named by tokens anyone can make up. So each
 * namespace whose objects a stranger can create has a total: one object in
 * it, named METER, adds up what the others hold, and refuses to let the
 * total grow past that namespace's limit. The limits together fit in the
 * 5 GB, so filling one never stops the others.
 *
 * An object calls reserve() before it stores more, and release() before it
 * deletes everything. It reserves a little more than it needs, so most writes
 * don't have to ask the meter again.
 *
 * Each object also counts OBJECT_BYTES, whatever it holds: Cloudflare keeps
 * even a tiny object in 12 KB, so without it a million tiny objects would
 * slip past every limit.
 *
 * The meter keeps only a hash of each object's id, and how much room it has.
 */
import {
  noContent,
  problem,
  sha256Text,
  type DurableObjectNamespace,
  type DurableObjectState,
} from './index.ts';

/** The meter's name in its namespace. Every other object is named by a 43-character hash. */
export const METER = 'meter';

/** What each object counts for besides its data. */
export const OBJECT_BYTES = 16 * 1024;

/** Where an object keeps how much the meter has granted it. */
export const GRANTED_KEY = 'meter:granted';

/** The Worker tells each object its namespace's limit in this header. */
export const LIMIT_HEADER = 'X-Storage-Limit';

/** For writes that must happen (an alarm saving what it already had): never refused. */
export const NO_LIMIT = Number.MAX_SAFE_INTEGER;

/** The limit the Worker sent with this request (0, so nothing grows, if it sent none). */
export function limitOf(request: Request): number {
  const limit = Number(request.headers.get(LIMIT_HEADER));
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
}

/** Room asked for beyond the data, so it can change size a little without asking again. */
const headroom = (bytes: number): number =>
  bytes === 0 ? 0 : Math.min(Math.max(Math.ceil(bytes / 4), 8 * 1024), 8 * 1024 * 1024);

interface MeterRequest {
  id: string;
  bytes: number;
  limit: number;
}

/**
 * In the fetch() of a metered namespace's class, for requests to the METER
 * object: sets what one object holds. Growing past the limit is refused
 * (507); shrinking never is. bytes 0 forgets the object.
 */
export async function meterFetch(state: DurableObjectState, request: Request): Promise<Response> {
  const { id, bytes, limit } = (await request.json()) as MeterRequest;
  return state.blockConcurrencyWhile(async () => {
    const key = `object:${id}`;
    const before = (await state.storage.get<number>(key)) ?? 0;
    const total = ((await state.storage.get<number>('total')) ?? 0) - before + bytes;
    if (bytes > before && total > limit) return problem(507, 'No room left.');
    if (bytes > 0) await state.storage.put(key, bytes);
    else await state.storage.delete(key);
    await state.storage.put('total', total);
    return noContent();
  });
}

/** Asks the meter to set what this object holds; false if there's no room. */
async function tell(
  state: DurableObjectState,
  namespace: DurableObjectNamespace,
  bytes: number,
  limit: number,
): Promise<boolean> {
  const meter = namespace.get(namespace.idFromName(METER));
  const body: MeterRequest = { id: await sha256Text(state.id.toString()), bytes, limit };
  const response = await meter.fetch('https://meter/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (response.status === 507) return false;
  if (!response.ok) throw new Error('The storage meter didn’t answer.');
  return true;
}

/**
 * Before this object stores more: makes sure it may hold `bytes` of data in
 * all (0 for objects counted only as objects). False if its namespace has no
 * room left: then store nothing. Also gives back room it no longer needs.
 */
export async function reserve(
  state: DurableObjectState,
  namespace: DurableObjectNamespace,
  bytes: number,
  limit: number,
): Promise<boolean> {
  const need = OBJECT_BYTES + bytes;
  const granted = (await state.storage.get<number>(GRANTED_KEY)) ?? 0;
  if (need <= granted && granted <= need + 2 * headroom(bytes)) return true;
  const ask = need + headroom(bytes);
  if (!(await tell(state, namespace, ask, limit))) return false;
  await state.storage.put(GRANTED_KEY, ask);
  return true;
}

/** Before this object deletes everything: it holds nothing from now on. */
export async function release(
  state: DurableObjectState,
  namespace: DurableObjectNamespace,
): Promise<void> {
  // Objects stored before there were meters were never counted.
  if ((await state.storage.get<number>(GRANTED_KEY)) === undefined) return;
  await tell(state, namespace, 0, 0);
  await state.storage.delete(GRANTED_KEY);
}
