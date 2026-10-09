// The browser as the page's side of the service worker sees it, in memory, for the tests of
// updates.ts. The tests move it through the states that the browser reports.
import { vi } from "vitest";
import type { ContainerLike, PageEnvironment, RegistrationLike, WorkerLike } from "../updates.ts";

export class FakeWorker extends EventTarget implements WorkerLike {
  state: ServiceWorkerState;
  readonly postMessage = vi.fn<(message: unknown, transfer: Transferable[]) => void>();

  constructor(state: ServiceWorkerState) {
    super();
    this.state = state;
  }

  /** Moves to `state`, and tells the page. */
  become(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

export class FakeRegistration extends EventTarget implements RegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  readonly update = vi.fn<() => Promise<unknown>>(async () => undefined);

  /** A new version starts to install. */
  found(): FakeWorker {
    const worker = new FakeWorker("installing");
    this.installing = worker;
    this.dispatchEvent(new Event("updatefound"));
    return worker;
  }

  /** The installing version has installed; it waits if another one is active. */
  installed(): void {
    const worker = this.installing;
    this.installing = null;
    this.waiting = worker;
    worker?.become("installed");
  }

  /**
   * The installing version fails to install. It says so before it leaves its place, as
   * browsers may tell a page.
   */
  failed(): void {
    const worker = this.installing;
    worker?.become("redundant");
    this.installing = null;
  }

  /** The waiting version, or else the installing one, becomes active. */
  activated(): void {
    const worker = this.waiting ?? this.installing;
    this.installing = null;
    this.waiting = null;
    this.active = worker;
    worker?.become("activated");
  }
}

export class FakeContainer extends EventTarget implements ContainerLike {
  controller: object | null;
  readonly registrations = [
    { unregister: vi.fn<() => Promise<boolean>>(async () => true) },
    { unregister: vi.fn<() => Promise<boolean>>(async () => true) },
  ];
  readonly getRegistrations = vi.fn<() => Promise<typeof this.registrations>>(
    async () => this.registrations,
  );

  constructor({ controlled }: { controlled: boolean }) {
    super();
    this.controller = controlled ? {} : null;
  }

  /** A newly active version takes control of the page. */
  takeOver(): void {
    this.controller = {};
    this.dispatchEvent(new Event("controllerchange"));
  }
}

export class FakeCaches {
  readonly names: string[];
  /** The keys of the responses that each cache keeps, by the cache's name. */
  readonly kept = new Map<string, Set<string>>();
  /** Whether finding a response fails, as when the browser's storage is damaged. */
  damaged = false;
  readonly keys = vi.fn<() => Promise<string[]>>(async () => [...this.names]);
  readonly match = vi.fn<
    (request: string, options: { cacheName: string }) => Promise<Response | undefined>
  >(async (request, { cacheName }) => {
    if (this.damaged) {
      throw new DOMException("The cache could not be read.", "UnknownError");
    }
    return this.kept.get(cacheName)?.has(request) === true ? new Response("true") : undefined;
  });
  readonly delete = vi.fn<(name: string) => Promise<boolean>>(async (name) => {
    const index = this.names.indexOf(name);
    if (index < 0) {
      return false;
    }
    this.names.splice(index, 1);
    return true;
  });

  constructor(names: readonly string[]) {
    this.names = [...names];
  }
}

export class FakePage implements PageEnvironment {
  readonly container: FakeContainer | undefined;
  readonly registration = new FakeRegistration();
  readonly register = vi.fn<() => Promise<RegistrationLike>>(async () => this.registration);
  readonly reload = vi.fn<() => void>();
  readonly caches: FakeCaches | undefined;
  time = 0;
  readonly #load = Promise.withResolvers<void>();
  readonly #visible: (() => void)[] = [];
  readonly #online: (() => void)[] = [];
  readonly #timers: { readonly interval: number; readonly listener: () => void; due: number }[] =
    [];

  constructor({
    container,
    caches = new FakeCaches([]),
  }: {
    container: FakeContainer | undefined;
    caches?: FakeCaches | undefined;
  }) {
    this.container = container;
    this.caches = caches;
  }

  async loaded(): Promise<void> {
    return this.#load.promise;
  }

  onVisible(listener: () => void): void {
    this.#visible.push(listener);
  }

  onOnline(listener: () => void): void {
    this.#online.push(listener);
  }

  every(interval: number, listener: () => void): void {
    this.#timers.push({ interval, listener, due: this.time + interval });
  }

  now(): number {
    return this.time;
  }

  /** The page has loaded; waits until the page's side has acted on it. */
  async finishLoading(): Promise<void> {
    this.#load.resolve();
    await settle();
  }

  /** The page becomes visible after `minutes`. */
  async becomeVisible(minutes: number): Promise<void> {
    this.time += minutes * 60 * 1000;
    for (const listener of this.#visible) {
      listener();
    }
    await settle();
  }

  /** The device comes back online after `minutes`. */
  async comeOnline(minutes: number): Promise<void> {
    this.time += minutes * 60 * 1000;
    for (const listener of this.#online) {
      listener();
    }
    await settle();
  }

  /** `minutes` pass with the page open, and its timers run as they fall due. */
  async wait(minutes: number): Promise<void> {
    const end = this.time + minutes * 60 * 1000;
    for (;;) {
      const next = this.#timers.toSorted((a, b) => a.due - b.due)[0];
      if (next === undefined || next.due > end) {
        break;
      }
      // A timer that fell due while the time jumped runs now, once.
      this.time = Math.max(this.time, next.due);
      next.due = this.time + next.interval;
      next.listener();
      await settle();
    }
    this.time = end;
  }
}

/** Waits until every promise that is ready has run. */
export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
