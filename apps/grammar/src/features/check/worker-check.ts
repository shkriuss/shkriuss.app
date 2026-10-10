import { startWorker } from "@shkriuss/edge/workers";
import { type RunningCheck, Unanswered } from "./checker.ts";
import harperWorker from "./harper.worker.ts?worker&url";
import { type CheckRequest, isCheckResponse } from "./protocol.ts";

/** How long requests wait for their answers, in milliseconds. */
export interface Deadlines {
  /** The first request's, which waits for the module too. */
  readonly first: number;
  /** Each later request's. */
  readonly later: number;
}

/**
 * How long a request waits for its answer before the worker is taken for dead: a worker that the
 * browser has ended, as for want of memory, answers nothing and reports nothing. The first
 * request waits for the module too, 8 MB to download the first time, over whatever network the
 * device has, and seconds to compile each time; the later ones wait for a check, which takes a
 * moment even for the longest text.
 */
export const DEADLINES: Deadlines = { first: 5 * 60_000, later: 30_000 };

/**
 * Starts the checker's worker, which starts loading Harper's module at once, and checks texts in
 * it: each request goes with a port for its answer, and the worker answers them in turn. A
 * request that has no answer by its deadline rejects with `Unanswered`.
 */
export function startWorkerCheck(deadlines: Deadlines = DEADLINES): RunningCheck {
  const worker = startWorker(harperWorker);
  let stopped = false;
  let first = true;
  // What ends each request that waits for an answer, once the worker is stopped.
  const pending = new Set<() => void>();
  const check: RunningCheck["check"] = async (text, variety) => {
    if (stopped) {
      throw new Error("The checker was stopped.");
    }
    const deadline = AbortSignal.timeout(first ? deadlines.first : deadlines.later);
    first = false;
    const channel = new MessageChannel();
    // Ends the request's listeners, on the worker too, once it has its answer, or none will come.
    const listening = new AbortController();
    const { signal } = listening;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const fail = (): void => {
      reject(new Error("The checker could not run."));
    };
    const end = (): void => {
      reject(new Error("The checker was stopped."));
    };
    pending.add(end);
    try {
      channel.port1.addEventListener(
        "message",
        (event) => {
          resolve(event.data);
        },
        { signal },
      );
      channel.port1.addEventListener("messageerror", fail, { signal });
      channel.port1.start();
      worker.addEventListener("error", fail, { signal });
      deadline.addEventListener(
        "abort",
        () => {
          reject(new Unanswered());
        },
        { signal },
      );
      const request: CheckRequest = { text, variety };
      worker.postMessage(request, [channel.port2]);
      const response = await promise;
      if (!isCheckResponse(response) || !response.ok) {
        throw new Error("The checker could not check the text.");
      }
      return response.mistakes;
    } finally {
      pending.delete(end);
      listening.abort();
      channel.port1.close();
    }
  };
  return {
    check,
    stop: () => {
      stopped = true;
      worker.terminate();
      for (const end of pending) {
        end();
      }
    },
  };
}
