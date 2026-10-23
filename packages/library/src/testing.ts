/**
 * An app's library server in memory, for tests: the real Worker code and
 * Durable Object, with storage and R2 kept in Maps.
 */
import type { DurableObjectListStorage, R2Bucket } from '@shkriuss/server';
import worker, { Library, LibraryGate, type LibraryEnv } from './worker.ts';

export class MemoryListStorage implements DurableObjectListStorage {
  readonly map = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.map.get(key)) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
    this.alarm = null;
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

async function bytesOf(value: ReadableStream | Uint8Array | null): Promise<Uint8Array> {
  if (value === null) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value.slice();
  return new Uint8Array(await new Response(value).arrayBuffer());
}

export class MemoryBucket implements R2Bucket {
  readonly files = new Map<string, Uint8Array>();

  async put(key: string, value: ReadableStream | Uint8Array | null): Promise<unknown> {
    this.files.set(key, await bytesOf(value));
    return {};
  }
  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    const file = this.files.get(key);
    if (!file) return null;
    const { offset = 0, length = file.length } = options?.range ?? {};
    if (offset + length > file.length) throw new RangeError('InvalidRange');
    const bytes = file.slice(offset, offset + length);
    return {
      body: new Response(bytes).body as ReadableStream<Uint8Array>,
      arrayBuffer: async () => bytes.buffer,
    };
  }
  async delete(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) this.files.delete(key);
  }
  async list(options: { prefix?: string; cursor?: string; limit?: number }) {
    const { prefix = '', limit = 1000 } = options;
    const start = Number(options.cursor ?? '0');
    const keys = [...this.files.keys()].filter((key) => key.startsWith(prefix)).sort();
    const page = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    return {
      objects: page.map((key) => ({ key })),
      truncated,
      ...(truncated ? { cursor: String(start + limit) } : {}),
    };
  }
}

/**
 * A library server in memory: its env, each library's object and storage,
 * and fetch(). `code` is its storage code (null: it has none).
 */
export function memoryLibrary(code: string | null = 'correct horse battery staple') {
  const objects = new Map<string, { library: Library; storage: MemoryListStorage }>();
  const bucket = new MemoryBucket();
  const gateStorage = new MemoryListStorage();
  const gate = new LibraryGate({ storage: gateStorage, blockConcurrencyWhile: (run) => run() });
  const env: LibraryEnv = {
    ASSETS: { fetch: async () => new Response('page') },
    LIBRARY_FILES: bucket,
    ...(code === null ? {} : { LIBRARY_STORAGE_CODE: code }),
    LIBRARY_GATE: {
      idFromName: (name) => ({ toString: () => name }),
      get: () => ({ fetch: (input, init) => gate.fetch(new Request(input, init)) }),
    },
    LIBRARIES: {
      idFromName: (name) => ({ toString: () => name }),
      get: (id) => ({
        fetch: (input, init) => {
          const name = id.toString();
          let found = objects.get(name);
          if (!found) {
            const storage = new MemoryListStorage();
            found = {
              storage,
              library: new Library({ storage, blockConcurrencyWhile: (run) => run() }, env),
            };
            objects.set(name, found);
          }
          return found.library.fetch(new Request(input, init));
        },
      }),
    },
  };
  return {
    env,
    bucket,
    objects,
    gate,
    gateStorage,
    fetch: (request: Request) => worker.fetch(request, env),
  };
}
