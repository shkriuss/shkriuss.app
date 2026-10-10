// The checker (docs/specs/apps/grammar.md §3): Harper, compiled to WebAssembly, in a worker of its
// own, so that typing never waits for it. Its module starts loading with the worker. It answers
// each request in turn, on the port that comes with it, with the mistakes in the text, or that it
// failed, as in a browser without WebAssembly.
import { Dialect } from "harper.js";
import { createLinter } from "./harper.ts";
import { mistakesOf } from "./lints.ts";
import { type CheckResponse, isCheckRequest, type Variety } from "./protocol.ts";

const DIALECTS: Readonly<Record<Variety, Dialect>> = {
  american: Dialect.American,
  british: Dialect.British,
  australian: Dialect.Australian,
  canadian: Dialect.Canadian,
  indian: Dialect.Indian,
};

/** What the page hears of a request that failed: that it did, and not why, which stays here. */
const FAILED: CheckResponse = { ok: false };

// The linter, once its module has loaded, which the page waits for through its first request.
// harper.js's linter starts loading the module when it is created, and leaves a failure of that
// unhandled, so `createLinter()` loads the module first and rejects instead: each request then
// reports the failure to the page. Nothing else here goes unhandled, so that any other failure
// of the worker is heard, as the end-to-end tests listen for one.
const linter = createLinter();
linter.catch(() => undefined);

async function answer(request: unknown): Promise<CheckResponse> {
  if (!isCheckRequest(request)) {
    return FAILED;
  }
  try {
    const ready = await linter;
    await ready.setDialect(DIALECTS[request.variety]);
    const lints = await ready.lint(request.text, { language: "plaintext" });
    return { ok: true, mistakes: mistakesOf(request.text, lints) };
  } catch {
    // What failed stays here: the page only says that the text could not be checked.
    return FAILED;
  }
}

/** Answers a request on its port, which then closes: with its mistakes, or that it failed. */
async function respond(request: unknown, port: MessagePort): Promise<void> {
  try {
    port.postMessage(await answer(request));
  } catch {
    // The answer could not be posted: the page hears that the check failed, all the same.
    port.postMessage(FAILED);
  } finally {
    port.close();
  }
}

/**
 * The requests, one after the other: the linter checks one text at a time. A request that fails,
 * even to answer, holds up no later one.
 */
let queue = Promise.resolve();

self.addEventListener("message", (event) => {
  const [port] = event.ports;
  if (port !== undefined) {
    queue = queue.then(async () => respond(event.data, port)).catch(() => undefined);
  }
});
