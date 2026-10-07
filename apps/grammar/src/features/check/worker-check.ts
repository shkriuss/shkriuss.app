import { startWorker } from "@shkriuss/edge/workers";
import type { Check } from "./checker.ts";
import harperWorker from "./harper.worker.ts?worker&url";
import { type CheckRequest, isCheckResponse } from "./protocol.ts";

/**
 * Starts the checker's worker, which starts loading Harper's module at once, and checks texts in
 * it: each request goes with a port for its answer, and the worker answers them in turn.
 */
export function startWorkerCheck(): Check {
  const worker = startWorker(harperWorker);
  return async (text, variety) => {
    const channel = new MessageChannel();
    // Ends the request's listeners, on the worker too, once it has its answer.
    const listening = new AbortController();
    const { signal } = listening;
    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const fail = (): void => {
          reject(new Error("The checker could not run."));
        };
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
        const request: CheckRequest = { text, variety };
        worker.postMessage(request, [channel.port2]);
      });
      if (!isCheckResponse(response) || !response.ok) {
        throw new Error("The checker could not check the text.");
      }
      return response.mistakes;
    } finally {
      listening.abort();
      channel.port1.close();
    }
  };
}
