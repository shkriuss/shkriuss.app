import { describe, expect, it, vi } from "vitest";
import { Unanswered } from "./checker.ts";
import type { CheckResponse, Mistake } from "./protocol.ts";
import { startWorkerCheck } from "./worker-check.ts";

/**
 * The checker's worker as the page starts it, in the unit tests, which run in Node.js, where
 * there are no web workers: it keeps each request with its port, on which the test answers, as
 * the worker does, or not at all. Hoisted, as the module mock below must see it.
 */
const { FakeWorker, started } = vi.hoisted(() => {
  class TestWorker extends EventTarget {
    readonly url: string;
    readonly requests: { readonly data: unknown; readonly port: MessagePort }[] = [];
    terminated = false;

    constructor(url: string) {
      super();
      this.url = url;
    }

    postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
      const [port] = transfer;
      if (port instanceof MessagePort) {
        this.requests.push({ data: structuredClone(message), port });
      }
    }

    terminate(): void {
      this.terminated = true;
    }

    /** Answers a request on its port: the latest, unless `index` says which. */
    answer(response: unknown, index = this.requests.length - 1): void {
      const request = this.requests[index];
      if (request === undefined) {
        throw new Error("The worker has no such request to answer.");
      }
      const { port } = request;
      port.postMessage(response);
    }

    /** Fails, as a worker whose script the browser refused, or that threw. */
    fail(): void {
      this.dispatchEvent(new Event("error"));
    }
  }
  const workers: TestWorker[] = [];
  return { FakeWorker: TestWorker, started: workers };
});

vi.mock("@shkriuss/edge/workers", () => ({
  startWorker: (url: string) => {
    const worker = new FakeWorker(url);
    started.push(worker);
    return worker;
  },
}));

/** Starts the checker's worker, and gives it with the fake that stands in for its worker. */
function start(deadlines?: { first: number; later: number }) {
  const running = startWorkerCheck(deadlines);
  const worker = started.at(-1);
  if (worker === undefined) {
    throw new Error("No worker started.");
  }
  return { running, worker };
}

describe("startWorkerCheck", () => {
  it("starts the checker's worker, and sends it each text with a port for the mistakes", async () => {
    const { running, worker } = start();
    expect(worker.url).toContain("harper.worker");
    const result = running.check("Their is a cat.", "british");
    expect(worker.requests.map((request) => request.data)).toStrictEqual([
      { text: "Their is a cat.", variety: "british" },
    ]);
    const mistakes: Mistake[] = [
      {
        kind: "Grammar",
        message: "Did you mean `there`?",
        start: 0,
        end: 5,
        fixes: [{ kind: "replace", text: "There" }],
      },
    ];
    worker.answer({ ok: true, mistakes } satisfies CheckResponse);
    await expect(result).resolves.toStrictEqual(mistakes);
  });

  it("rejects when the worker answers that it failed, or with what is no answer", async () => {
    const { running, worker } = start();
    const failed = running.check("Hello.", "american");
    worker.answer({ ok: false } satisfies CheckResponse);
    await expect(failed).rejects.toThrow("could not check");
    const nonsense = running.check("Hello.", "american");
    worker.answer({ ok: true, mistakes: "none" });
    await expect(nonsense).rejects.toThrow("could not check");
  });

  it("rejects when the worker fails, as when the browser refused its script or it threw", async () => {
    // The screen then says that the text could not be checked.
    const { running, worker } = start();
    const result = running.check("Hello.", "american");
    worker.fail();
    await expect(result).rejects.toThrow("could not run");
  });

  it("takes the worker for dead when it has not answered by the deadline, the first request given longer", async () => {
    const { running, worker } = start({ first: 2000, later: 10 });
    const first = running.check("", "american");
    const later = running.check("Hello.", "american");
    await expect(later).rejects.toBeInstanceOf(Unanswered);
    // The first request still waits: the module may still be downloading or compiling.
    worker.answer({ ok: true, mistakes: [] } satisfies CheckResponse, 0);
    await expect(first).resolves.toStrictEqual([]);
  });

  it("stops the worker, ends the requests that wait for it, and takes no more", async () => {
    const { running, worker } = start();
    const waiting = running.check("Hello.", "american");
    running.stop();
    expect(worker.terminated).toBe(true);
    await expect(waiting).rejects.toThrow("stopped");
    await expect(running.check("Again.", "american")).rejects.toThrow("stopped");
    expect(worker.requests).toHaveLength(1);
  });
});
