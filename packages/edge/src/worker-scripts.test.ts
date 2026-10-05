import { describe, expect, it } from "vitest";
import {
  SERVICE_WORKER_PATH,
  WORKER_POLICY,
  isWorkerBundlePath,
  isWorkerScriptPath,
  workerScriptUrl,
} from "./worker-scripts.ts";

const PAGE = "https://notes.shkriuss.app/lists/today";
const BUNDLE = "/assets/age.worker-AbC_12-z.js";

describe("isWorkerScriptPath", () => {
  it.each([BUNDLE, "/assets/ping.worker-Df7253_1.js", "/assets/a-b-2.worker-00000000.js"])(
    "accepts the worker bundle %s",
    (path) => {
      expect(isWorkerBundlePath(path)).toBe(true);
      expect(isWorkerScriptPath(path)).toBe(true);
    },
  );

  it("accepts the service worker, which is not a bundle", () => {
    expect(isWorkerScriptPath(SERVICE_WORKER_PATH)).toBe(true);
    expect(isWorkerBundlePath(SERVICE_WORKER_PATH)).toBe(false);
  });

  it.each([
    "/assets/index-AbC_12-z.js",
    "/assets/age-AbC_12-z.js",
    "/assets/age.worker-AbC_12-.js.map",
    "/assets/age.worker-AbC_12-zz.js",
    "/assets/age.worker-AbC_12.js",
    "/assets/Age.worker-AbC_12-z.js",
    "/assets/age_x.worker-AbC_12-z.js",
    "/assets/-age.worker-AbC_12-z.js",
    "/assets/age--x.worker-AbC_12-z.js",
    "/assets/sub/age.worker-AbC_12-z.js",
    "/assets/../age.worker-AbC_12-z.js",
    "/age.worker-AbC_12-z.js",
    "assets/age.worker-AbC_12-z.js",
    "/assets/age.worker-AbC_12-z.mjs",
    "/sw.mjs",
    "/sw.js/",
    "/assets/sw.js",
    "/sw.js?v=2",
    "",
  ])("refuses %j", (path) => {
    expect(isWorkerScriptPath(path)).toBe(false);
  });

  it("names a policy that the Content-Security-Policy can list", () => {
    expect(WORKER_POLICY).toMatch(/^[A-Za-z0-9\-#=_/@.%]+$/);
  });
});

describe("workerScriptUrl", () => {
  it.each([
    [BUNDLE, `https://notes.shkriuss.app${BUNDLE}`],
    [`https://notes.shkriuss.app${BUNDLE}`, `https://notes.shkriuss.app${BUNDLE}`],
    ["/sw.js", "https://notes.shkriuss.app/sw.js"],
    // The URL parser normalizes these to the same script, and the policy returns that URL.
    ["/assets/../sw.js", "https://notes.shkriuss.app/sw.js"],
    ["/assets/%2e%2e/sw.js", "https://notes.shkriuss.app/sw.js"],
    ["\\sw.js", "https://notes.shkriuss.app/sw.js"],
    ["https://notes.shkriuss.app:443/sw.js", "https://notes.shkriuss.app/sw.js"],
  ])("resolves %j to %j", (input, expected) => {
    expect(workerScriptUrl(input, PAGE)).toBe(expected);
  });

  it.each([
    ["another origin", `https://evil.example${BUNDLE}`],
    ["another app", `https://todo.shkriuss.app${BUNDLE}`],
    ["another scheme", `http://notes.shkriuss.app${BUNDLE}`],
    ["another port", `https://notes.shkriuss.app:8443${BUNDLE}`],
    ["a protocol-relative URL", `//evil.example${BUNDLE}`],
    ["a query", `${BUNDLE}?x=1`],
    ["an empty query", `${BUNDLE}?`],
    ["a fragment", "/sw.js#x"],
    ["user credentials", `https://user:secret@notes.shkriuss.app${BUNDLE}`],
    ["a path relative to the page", BUNDLE.slice(1)],
    ["a chunk the page imports", "/assets/index-AbC_12-z.js"],
    ["the page", "/"],
    ["a data: URL", "data:text/javascript,postMessage(1)"],
    ["a blob: URL", "blob:https://notes.shkriuss.app/0b3a6c1e-2c8b-4c1e-9d43-6f1f2b8f3a51"],
    ["an encoded name", "/assets/%61ge.worker-AbC_12-z.js"],
    ["an invalid URL", "https://["],
  ])("refuses %s", (_case, input) => {
    expect(() => workerScriptUrl(input, PAGE)).toThrow(TypeError);
  });

  it("says which URL it refused", () => {
    expect(() => workerScriptUrl("https://evil.example/x.js", PAGE)).toThrow(
      '"https://evil.example/x.js" is not one of this app\'s worker scripts (ADR 0011).',
    );
  });

  it("works on any origin, such as the local test server", () => {
    expect(workerScriptUrl("/sw.js", "http://127.0.0.1:4174/")).toBe("http://127.0.0.1:4174/sw.js");
    expect(() => workerScriptUrl("http://localhost:4174/sw.js", "http://127.0.0.1:4174/")).toThrow(
      TypeError,
    );
  });
});
