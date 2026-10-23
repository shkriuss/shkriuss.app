/**
 * An app's notification server in memory, for tests: the real Worker code and
 * Durable Objects, with storage kept in Maps. Tests replace the global fetch()
 * to play the push service.
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import { METER } from '@shkriuss/server/meter';
import { MemoryStorage, memoryState } from '@shkriuss/server/testing';
import worker, { PushDevice, PushKeys, type PushEnv } from './worker.ts';

export { MemoryStorage, memoryState } from '@shkriuss/server/testing';

/** A made-up device key, as a phone would send it. */
export const deviceKey = (): string => toBase64Url(randomBytes(32));

/**
 * A notification server in memory: its env, each device's object and
 * storage, how often the signing object was asked to sign, fetch(), and
 * runAlarms(), which wakes each object whose alarm is due, as Cloudflare does.
 */
export function memoryPush() {
  const devices = new Map<string, { device: PushDevice; storage: MemoryStorage }>();
  /** The app's storage meter, kept apart from the devices (it's one of the same objects). */
  const meter = { storage: new MemoryStorage(), device: undefined as PushDevice | undefined };
  const keysStorage = new MemoryStorage();
  const keys = new PushKeys(memoryState(keysStorage, 'vapid'));
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
          if (name === METER) {
            meter.device ??= new PushDevice(memoryState(meter.storage, name), env);
            return meter.device.fetch(new Request(input, init));
          }
          let found = devices.get(name);
          if (!found) {
            const storage = new MemoryStorage();
            found = { storage, device: new PushDevice(memoryState(storage, name), env) };
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
    meter: meter.storage,
    keysStorage,
    counts,
    runAlarms,
    fetch: (request: Request) => worker.fetch(request, env),
  };
}
