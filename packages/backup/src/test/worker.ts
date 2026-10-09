/**
 * The backup worker in the unit tests, which run in Node.js, where there are no web workers.
 * Test files replace `@shkriuss/edge/workers` with this module: `startWorker()` then runs the
 * worker's module on the test's own thread, and messages go to it and back as a browser passes
 * them, cloned. The end-to-end tests run the real worker in browsers.
 */

/** The global scope of the worker, which `self` is while its module loads. */
const scope = new EventTarget();
let loaded: Promise<unknown> | undefined;

function load(): Promise<unknown> {
  loaded ??= (async () => {
    Reflect.set(globalThis, "self", scope);
    // What the worker posts once its script has run: the module loads only once, so each
    // `TestWorker` says it itself.
    Reflect.set(globalThis, "postMessage", () => undefined);
    try {
      return await import("../age.worker.ts");
    } finally {
      Reflect.deleteProperty(globalThis, "self");
      Reflect.deleteProperty(globalThis, "postMessage");
    }
  })();
  return loaded;
}

/** What the next worker does instead of answering as the backup worker. */
type Behavior =
  { readonly fails: true } | { readonly answers: unknown } | { readonly runsAfter: Promise<void> };

let next: Behavior | undefined;

/** The next worker fails to start, as it would if the browser refused its script. */
export function failNextWorker(): void {
  next = { fails: true };
}

/** The next worker answers with `answer`, whatever it is asked. */
export function answerNextWith(answer: unknown): void {
  next = { answers: answer };
}

/**
 * The script of the next worker runs only once the returned function is called, as if it still
 * loaded or compiled until then.
 */
export function holdNextWorker(): () => void {
  const { promise, resolve } = Promise.withResolvers<void>();
  next = { runsAfter: promise };
  return () => {
    resolve();
  };
}

export class TestWorker extends EventTarget {
  readonly url: string;
  /** Whether the worker said that its script has run. */
  running = false;
  terminated = false;
  /** Whether the page stopped the worker before it said that its script has run. */
  terminatedBeforeRunning = false;
  readonly #behavior: Behavior | undefined;

  constructor(url: string) {
    super();
    this.url = url;
    this.#behavior = next;
    next = undefined;
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const ports = transfer.filter((item) => item instanceof MessagePort);
    const data: unknown = structuredClone(message, {
      transfer: transfer.filter((item) => !(item instanceof MessagePort)),
    });
    void this.#receive(data, ports);
  }

  terminate(): void {
    this.terminatedBeforeRunning ||= !this.running;
    this.terminated = true;
  }

  /** The worker's script has run, which the worker says, as the backup worker does. */
  #run(): void {
    if (!this.running) {
      this.running = true;
      this.dispatchEvent(new MessageEvent("message", { data: "running" }));
    }
  }

  async #receive(data: unknown, ports: MessagePort[]): Promise<void> {
    const behavior = this.#behavior;
    if (behavior === undefined || "runsAfter" in behavior) {
      await behavior?.runsAfter;
      await load();
      this.#run();
      if (!this.terminated) {
        scope.dispatchEvent(new MessageEvent("message", { data, ports }));
      }
    } else if ("fails" in behavior) {
      this.dispatchEvent(new Event("error"));
    } else {
      this.#run();
      ports[0]?.postMessage(behavior.answers);
    }
  }
}

/** The workers started so far. */
export const started: TestWorker[] = [];

/** Starts the backup worker, the only worker of `@shkriuss/backup`. */
export function startWorker(url: string): TestWorker {
  if (new URL(url, "http://localhost").pathname !== "/src/age.worker.ts") {
    throw new TypeError(`${url} is not the backup worker.`);
  }
  const worker = new TestWorker(url);
  started.push(worker);
  return worker;
}
