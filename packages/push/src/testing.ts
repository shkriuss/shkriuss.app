/**
 * An app's notification server in memory, for tests: the real Worker code and
 * Durable Objects, with storage kept in Maps. Tests replace the global fetch()
 * to play the push service.
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import type { DurableObjectState, DurableObjectStorage } from '@shkriuss/server';
import worker, { PushDevice, PushKeys, type PushEnv } from './worker.ts';

/** The most one stored value can be on Cloudflare (2 MB); bigger ones are refused. */
const MAX_VALUE_LENGTH = 2 * 1024 * 1024;

export class MemoryStorage implements DurableObjectStorage {
  readonly map = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.map.get(key)) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    if (JSON.stringify(value).length > MAX_VALUE_LENGTH) throw new RangeError('Value too big');
    this.map.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
  }
  async setAlarm(time: number): Promise<void> {
    this.alarm = time;
  }
  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

/** Like a real Durable Object: nothing else runs while blockConcurrencyWhile() does. */
export function memoryState(storage: DurableObjectStorage): DurableObjectState {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    storage,
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const result = queue.then(callback);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

/** A made-up device key, as a phone would send it. */
export const deviceKey = (): string => toBase64Url(randomBytes(32));

/**
 * A notification server in memory: its env, each device's object and
 * storage, how often the signing object was asked to sign, fetch(), and
 * runAlarms(), which wakes each object whose alarm is due, as Cloudflare does.
 */
export function memoryPush() {
  const devices = new Map<string, { device: PushDevice; storage: MemoryStorage }>();
  const keysStorage = new MemoryStorage();
  const keys = new PushKeys(memoryState(keysStorage));
  const counts = { signs: 0, wakes: 0 };
  const env: PushEnv = {
    ASSETS: { fetch: async () => new Response('page') },
    PUSH_KEYS: {
      idFromName: () => ({ toString: () => 'vapid' }),
      get: () => ({
        fetch: (input, init) => {
          if (input.endsWith('/sign')) counts.signs += 1;
          return keys.fetch(new Request(input, init));
        },
      }),
    },
    PUSH_DEVICES: {
      idFromName: (name) => ({ toString: () => name }),
      get: (id) => ({
        fetch: (input, init) => {
          const name = id.toString();
          let found = devices.get(name);
          if (!found) {
            const storage = new MemoryStorage();
            found = { storage, device: new PushDevice(memoryState(storage), env) };
            devices.set(name, found);
          }
          return found.device.fetch(new Request(input, init));
        },
      }),
    },
  };

  /** Wakes every object whose alarm is due by now, until none is. */
  async function runAlarms(): Promise<void> {
    for (;;) {
      const due = [...devices.values()].filter(
        ({ storage }) => storage.alarm !== null && storage.alarm <= Date.now(),
      );
      if (due.length === 0) return;
      for (const { device, storage } of due) {
        storage.alarm = null;
        counts.wakes += 1;
        await device.alarm();
      }
    }
  }

  return {
    env,
    devices,
    keysStorage,
    counts,
    runAlarms,
    fetch: (request: Request) => worker.fetch(request, env),
  };
}
