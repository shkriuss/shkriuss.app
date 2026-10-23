/**
 * Durable Objects in memory, for tests: each object's storage in a Map, one
 * request at a time per object (like blockConcurrencyWhile), and alarms that
 * run when a test asks.
 */
import type {
  DurableObjectListState,
  DurableObjectListStorage,
  DurableObjectNamespace,
} from './index.ts';

/** The most one stored value can be on Cloudflare (2 MB); bigger ones are refused. */
const MAX_VALUE_LENGTH = 2 * 1024 * 1024;

const sizeOf = (value: unknown): number =>
  value instanceof Uint8Array ? value.length : JSON.stringify(value).length;

export class MemoryStorage implements DurableObjectListStorage {
  readonly map = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.map.get(key)) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    if (sizeOf(value) > MAX_VALUE_LENGTH) throw new RangeError('Value too big');
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
  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }
  async list<T>(options: { prefix?: string; startAfter?: string; limit?: number }) {
    const { prefix = '', startAfter = '', limit = Infinity } = options;
    const keys = [...this.map.keys()]
      .filter((key) => key.startsWith(prefix) && key > startAfter)
      .sort()
      .slice(0, limit);
    return new Map(keys.map((key) => [key, structuredClone(this.map.get(key)) as T]));
  }
}

/** An object's state: its storage, its name as its id, and nothing else running during blockConcurrencyWhile(). */
export function memoryState(
  storage: DurableObjectListStorage,
  name = 'object',
): DurableObjectListState {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    id: { toString: () => name },
    storage,
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const result = queue.then(callback);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

interface MemoryObject {
  fetch(request: Request): Promise<Response>;
  alarm?(): Promise<void>;
}

/**
 * A namespace of objects made by `make` when first asked for, by name. Its
 * `objects` are there to look into, and runAlarms() wakes each object whose
 * alarm is due by now (Date.now(), so tests can move the clock), until none
 * is, as Cloudflare does. It returns how many it woke.
 */
export function memoryNamespace<T extends MemoryObject>(
  make: (state: DurableObjectListState) => T,
) {
  const objects = new Map<string, { object: T; storage: MemoryStorage }>();
  const find = (name: string) => {
    let found = objects.get(name);
    if (!found) {
      const storage = new MemoryStorage();
      found = { storage, object: make(memoryState(storage, name)) };
      objects.set(name, found);
    }
    return found;
  };
  const namespace: DurableObjectNamespace = {
    idFromName: (name) => ({ toString: () => name }),
    get: (id) => ({
      fetch: (input, init) => find(id.toString()).object.fetch(new Request(input, init)),
    }),
  };
  async function runAlarms(): Promise<number> {
    let woken = 0;
    for (;;) {
      const due = [...objects.values()].filter(
        ({ storage }) => storage.alarm !== null && storage.alarm <= Date.now(),
      );
      if (due.length === 0) return woken;
      for (const { object, storage } of due) {
        storage.alarm = null;
        woken += 1;
        await object.alarm?.();
      }
    }
  }
  /** Objects that keep anything (the meter, named "meter", included). */
  const stored = () => [...objects].filter(([, { storage }]) => storage.map.size > 0);
  return { namespace, objects, runAlarms, stored };
}
