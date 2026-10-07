// The checker (docs/specs/apps/grammar.md §3): Harper, compiled to WebAssembly, in a worker of its
// own, so that typing never waits for it. Its linter starts loading with the worker. It answers
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

const linter = createLinter();

// harper.js starts loading its module when it creates the linter, and leaves a failure of that
// unhandled; each request reports it to the page instead.
self.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
});

async function answer(request: unknown): Promise<CheckResponse> {
  if (!isCheckRequest(request)) {
    return { ok: false };
  }
  try {
    await linter.setDialect(DIALECTS[request.variety]);
    const lints = await linter.lint(request.text, { language: "plaintext" });
    return { ok: true, mistakes: mistakesOf(request.text, lints) };
  } catch {
    // What failed stays here: the page only says that the text could not be checked.
    return { ok: false };
  }
}

/** Answers a request on its port, which then closes. */
async function respond(request: unknown, port: MessagePort): Promise<void> {
  port.postMessage(await answer(request));
  port.close();
}

/** The requests, one after the other: the linter checks one text at a time. */
let queue = Promise.resolve();

self.addEventListener("message", (event) => {
  const [port] = event.ports;
  if (port !== undefined) {
    queue = queue.then(async () => respond(event.data, port));
  }
});
