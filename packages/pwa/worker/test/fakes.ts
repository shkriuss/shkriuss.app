// A service worker's global scope in memory, for the tests of worker.ts: Cache Storage, the
// clients, and a host whose answers the tests set. Like a browser, its fetch() checks a
// request's integrity, refuses redirects when asked to, and stops when the request is aborted.
import { vi } from "vitest";
import type { BuildData } from "../../src/protocol.ts";
import type {
  CacheLike,
  CacheStorageLike,
  Extendable,
  FetchEventLike,
  MessageEventLike,
  WindowClientLike,
  WorkerScope,
} from "../worker.ts";

export const ORIGIN = "https://notes.shkriuss.app";

/** A response as Cache Storage keeps it. */
interface Kept {
  readonly body: ArrayBuffer;
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
}

async function keep(response: Response): Promise<Kept> {
  return {
    body: await response.arrayBuffer(),
    status: response.status,
    headers: [...response.headers],
  };
}

function restore(kept: Kept): Response {
  return new Response(kept.body, {
    status: kept.status,
    headers: kept.headers.map(([n, v]) => [n, v]),
  });
}

class FakeCache implements CacheLike {
  readonly #entries: Map<string, Kept>;

  constructor(entries: Map<string, Kept>) {
    this.#entries = entries;
  }

  async keys(): Promise<Request[]> {
    return [...this.#entries.keys()].map((url) => new Request(url));
  }

  async put(request: string, response: Response): Promise<void> {
    this.#entries.set(request, await keep(response));
  }
}

export class FakeCaches implements CacheStorageLike {
  readonly stores = new Map<string, Map<string, Kept>>();

  async open(name: string): Promise<CacheLike> {
    let store = this.stores.get(name);
    if (store === undefined) {
      store = new Map();
      this.stores.set(name, store);
    }
    return new FakeCache(store);
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async match(
    request: string,
    { cacheName }: { cacheName: string },
  ): Promise<Response | undefined> {
    const kept = this.stores.get(cacheName)?.get(request);
    return kept === undefined ? undefined : restore(kept);
  }

  /** The text of every response in a cache, by URL path; undefined if there is no such cache. */
  async texts(name: string): Promise<Record<string, string> | undefined> {
    const store = this.stores.get(name);
    if (store === undefined) {
      return undefined;
    }
    const texts: Record<string, string> = {};
    for (const [url, kept] of store) {
      texts[new URL(url).pathname] = new TextDecoder().decode(kept.body);
    }
    return texts;
  }

  /** Puts a response with `text` into a cache directly, as an earlier version did. */
  async seed(name: string, files: Record<string, string>): Promise<void> {
    const cache = await this.open(name);
    for (const [path, text] of Object.entries(files)) {
      await cache.put(`${ORIGIN}${path}`, new Response(text));
    }
  }
}

/** What the host answers for a path: a file's text, a status, a redirect, or no answer. */
export type Answer =
  | string
  | { readonly status: number }
  | { readonly redirect: string }
  | { readonly network: "error" | "no answer until aborted" };

export const NETWORK_ERROR: Answer = { network: "error" };
export const NO_ANSWER: Answer = { network: "no answer until aborted" };

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function integrityOf(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return `sha256-${btoa(String.fromCharCode(...digest))}`;
}

/** The data of a build whose files have these texts, by URL path. */
export async function buildOf(
  files: Record<string, string>,
  version: string,
  replaces: readonly string[] = [],
): Promise<BuildData> {
  const list = await Promise.all(
    Object.entries(files).map(async ([url, text]) => ({ url, sha256: await sha256(text) })),
  );
  return { version, files: list, replaces };
}

export class FakeWindow implements WindowClientLike {
  readonly url: string;
  readonly navigate = vi.fn<(url: string) => Promise<unknown>>(async () => this);

  constructor(url: string) {
    this.url = url;
  }
}

/** Every kind of event at once, so one listener map holds them all. */
type AnyEvent = Extendable & FetchEventLike & MessageEventLike;

export class FakeScope implements WorkerScope {
  readonly caches: FakeCaches;
  readonly location = { origin: ORIGIN };
  readonly windows: FakeWindow[] = [];
  readonly clients = {
    claim: vi.fn<() => Promise<void>>(async () => undefined),
    matchAll: vi.fn<(options: { type: "window" }) => Promise<FakeWindow[]>>(
      async () => this.windows,
    ),
  };
  readonly registration = { unregister: vi.fn<() => Promise<boolean>>(async () => true) };
  readonly skipWaiting = vi.fn<() => Promise<void>>(async () => undefined);
  /** What the host answers, by URL path; anything else is a network error. */
  readonly host = new Map<string, Answer>();
  /** Every request that went to the network. */
  readonly requests: Request[] = [];
  readonly #listeners = new Map<string, (event: AnyEvent) => void>();

  /** A scope of its own, or one that shares Cache Storage with another version's. */
  constructor(caches = new FakeCaches()) {
    this.caches = caches;
  }

  addEventListener(type: string, listener: (event: AnyEvent) => void): void {
    this.#listeners.set(type, listener);
  }

  async fetch(request: Request): Promise<Response> {
    this.requests.push(request);
    const answer = this.host.get(new URL(request.url).pathname) ?? NETWORK_ERROR;
    if (typeof answer === "object" && "network" in answer && answer.network === "error") {
      throw new TypeError("Failed to fetch");
    }
    if (typeof answer === "object" && "network" in answer) {
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(new DOMException("The request was aborted.", "AbortError"));
        });
      });
    }
    if (typeof answer === "object" && "redirect" in answer) {
      if (request.redirect === "error") {
        throw new TypeError("Failed to fetch: redirected");
      }
      return new Response(null, { status: 307, headers: { Location: answer.redirect } });
    }
    if (typeof answer === "object") {
      return new Response("", { status: answer.status });
    }
    if (request.integrity !== "" && request.integrity !== (await integrityOf(answer))) {
      throw new TypeError("Failed to fetch: the integrity check failed");
    }
    return new Response(answer, { headers: { "Content-Type": "text/plain" } });
  }

  #event(fields: Partial<AnyEvent>): AnyEvent {
    return {
      request: new Request(ORIGIN),
      data: undefined,
      source: undefined,
      respondWith: () => {
        throw new Error("Only a fetch event has respondWith().");
      },
      waitUntil: () => {
        throw new Error("This event's waitUntil() is not expected here.");
      },
      ...fields,
    };
  }

  #listener(type: string): (event: AnyEvent) => void {
    const listener = this.#listeners.get(type);
    if (listener === undefined) {
      throw new Error(`The service worker does not listen to ${type} events.`);
    }
    return listener;
  }

  /** Dispatches `install` or `activate`; rejects as the event fails. */
  async lifecycle(type: "install" | "activate"): Promise<void> {
    const extended: Promise<unknown>[] = [];
    this.#listener(type)(
      this.#event({
        waitUntil: (promise) => {
          extended.push(promise);
        },
      }),
    );
    await Promise.all(extended);
  }

  /**
   * Dispatches a fetch event for a request of a page, and waits for everything it started: the
   * service worker's response, or "network" if it lets the request go to the network itself.
   */
  async request(
    url: string,
    { navigate = false, method = "GET" }: { navigate?: boolean; method?: string } = {},
  ): Promise<Response | "network"> {
    const request = new Request(new URL(url, ORIGIN), { method });
    if (navigate) {
      // A page's navigation; scripts cannot construct one.
      Object.defineProperty(request, "mode", { value: "navigate" });
    }
    const responses: Promise<Response>[] = [];
    const extended: Promise<unknown>[] = [];
    this.#listener("fetch")(
      this.#event({
        request,
        respondWith: (response) => {
          responses.push(response);
        },
        waitUntil: (promise) => {
          extended.push(promise);
        },
      }),
    );
    const [responded] = responses;
    if (responded === undefined) {
      return "network";
    }
    const response = await responded;
    await Promise.all(extended);
    return response;
  }

  /** Sends the service worker a message; resolves once it has handled it. */
  async message(data: unknown, source: unknown): Promise<void> {
    const extended: Promise<unknown>[] = [];
    this.#listener("message")(
      this.#event({
        data,
        source,
        waitUntil: (promise) => {
          extended.push(promise);
        },
      }),
    );
    await Promise.all(extended);
  }
}
