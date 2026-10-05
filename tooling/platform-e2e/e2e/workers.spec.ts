import type { Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";
import {
  MANIFEST_FILE,
  WORKER_POLICY,
  cspHashSource,
  isWorkerBundlePath,
  parseManifest,
  securityHeaders,
} from "@shkriuss/edge";

// Workers under Trusted Types (ADR 0011): the app starts its own worker scripts through the one
// policy it may have, and the browser refuses everything else.

const IMPORT_MAP = /<script type="importmap">(.*?)<\/script>/s;

/** Opens the test app and waits until its script has run. */
async function open(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.platform !== undefined);
}

/**
 * Starts the worker or registers the service worker, sends it `message` with a port to answer
 * on, and returns the answer.
 */
async function ask(
  page: Page,
  target: "worker" | "service worker",
  message: "ping" | "create-policy",
): Promise<unknown> {
  return page.evaluate(
    async ({ to, text }) => {
      const { platform } = window;
      if (platform === undefined) {
        throw new Error("The test app has not loaded.");
      }
      const channel = new MessageChannel();
      const answer = Promise.withResolvers<unknown>();
      channel.port1.addEventListener("message", (event) => {
        answer.resolve(event.data);
      });
      channel.port1.start();
      const timeout = setTimeout(() => {
        answer.reject(new Error(`The ${to} did not answer within 10 seconds.`));
      }, 10_000);
      if (to === "worker") {
        const worker = platform.startWorker(platform.pingWorker);
        worker.addEventListener("error", () => {
          answer.reject(new Error("The worker failed to start."));
        });
        worker.postMessage(text, [channel.port2]);
      } else {
        await platform.registerServiceWorker();
        const registration = await navigator.serviceWorker.ready;
        if (registration.active === null) {
          throw new Error("The service worker is not active.");
        }
        registration.active.postMessage(text, [channel.port2]);
      }
      try {
        return await answer.promise;
      } finally {
        clearTimeout(timeout);
      }
    },
    { to: target, text: message },
  );
}

test.describe("headers", () => {
  test("the page allows the worker policy and no other", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    const importMap = IMPORT_MAP.exec(await response.text())?.[1] ?? "";
    const headers = response.headers();
    const expected = securityHeaders({ scriptHashes: [cspHashSource(importMap)], workers: true });
    for (const [name, value] of expected) {
      expect(headers[name.toLowerCase()], name).toBe(value);
    }
    expect(headers["content-security-policy"]).toMatch(
      new RegExp(`; trusted-types ${WORKER_POLICY}$`),
    );
  });

  test("worker scripts come with the page's security headers", async ({ request }) => {
    const page = await request.get("/");
    const manifest = parseManifest(await (await request.get(`/${MANIFEST_FILE}`)).text());
    const bundles = [...manifest.keys()].filter(isWorkerBundlePath);
    // The test app's own worker, and the backup worker of @shkriuss/backup.
    expect(bundles.map((path) => path.replace(/-[\w-]{8}\.js$/, "")).toSorted()).toEqual([
      "/assets/age.worker",
      "/assets/ping.worker",
    ]);

    for (const path of [...bundles, "/sw.js"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const headers = response.headers();
      expect(headers["content-type"], path).toMatch(/^(?:application|text)\/javascript\b/);
      // A worker runs under the policy of its own script's response.
      for (const [name] of securityHeaders({ scriptHashes: [] })) {
        const header = name.toLowerCase();
        expect(headers[header], `${path}: ${name}`).toBe(page.headers()[header]);
      }
    }
  });

  test("the service worker is revalidated on every load, worker bundles are cached", async ({
    request,
  }) => {
    const sw = await request.get("/sw.js");
    expect(sw.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
    const manifest = parseManifest(await (await request.get(`/${MANIFEST_FILE}`)).text());
    for (const path of [...manifest.keys()].filter(isWorkerBundlePath)) {
      const bundle = await request.get(path);
      expect(bundle.headers()["cache-control"], path).toBe("public, max-age=31536000, immutable");
    }
  });
});

test.describe("workers", () => {
  test("the app starts its worker", async ({ page }) => {
    await open(page);
    expect(await ask(page, "worker", "ping")).toBe("pong");
  });

  test("the app registers its service worker for the whole app", async ({ page, baseURL }) => {
    await open(page);
    expect(await ask(page, "service worker", "ping")).toBe("pong");
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(`${baseURL ?? ""}/`);
  });

  for (const target of ["worker", "service worker"] as const) {
    test(`code in the ${target} cannot create another Trusted Types policy`, async ({
      page,
      security,
    }) => {
      security.expectRefusals();
      await open(page);
      const answer = await ask(page, target, "create-policy");
      // "unsupported" where an engine has no Trusted Types in workers: then there is no policy
      // to create either.
      expect(["refused", "unsupported"]).toContain(answer);
      console.info(`Creating a policy in the ${target}: ${String(answer)}`);
    });
  }
});

test.describe("the worker policy", () => {
  test("starts nothing but the app's own worker scripts", async ({ page }) => {
    await open(page);
    const results = await page.evaluate(() => {
      const { platform } = window;
      if (platform === undefined) {
        throw new Error("The test app has not loaded.");
      }
      const blob = URL.createObjectURL(new Blob(["postMessage(1);"], { type: "text/javascript" }));
      const urls: Record<string, string> = {
        "another origin": `https://example.com${platform.pingWorker}`,
        "a query": `${platform.pingWorker}?x=1`,
        "a fragment": `${platform.pingWorker}#x`,
        "a module of the page": "/assets/index-00000000.js",
        "the page": "/",
        "a data: URL": "data:text/javascript,postMessage(1)",
        "a blob: URL": blob,
      };
      const outcomes: Record<string, string> = {};
      for (const [name, url] of Object.entries(urls)) {
        try {
          platform.startWorker(url).terminate();
          outcomes[name] = "started";
        } catch (error) {
          outcomes[name] = error instanceof TypeError ? "refused" : String(error);
        }
      }
      URL.revokeObjectURL(blob);
      return outcomes;
    });
    expect(results).toEqual({
      "another origin": "refused",
      "a query": "refused",
      "a fragment": "refused",
      "a module of the page": "refused",
      "the page": "refused",
      "a data: URL": "refused",
      "a blob: URL": "refused",
    });
  });

  test("the browser refuses plain strings as worker scripts", async ({ page, security }) => {
    security.expectRefusals();
    await open(page);
    const results = await page.evaluate(async () => {
      const { platform } = window;
      if (platform === undefined) {
        throw new Error("The test app has not loaded.");
      }
      let worker: string;
      try {
        new Worker(platform.pingWorker).terminate();
        worker = "started";
      } catch (error) {
        worker = error instanceof TypeError ? "refused" : String(error);
      }
      let serviceWorker: string;
      try {
        await navigator.serviceWorker.register("/sw.js");
        serviceWorker = "registered";
      } catch (error) {
        serviceWorker = error instanceof TypeError ? "refused" : String(error);
      }
      return { worker, serviceWorker };
    });
    expect(results).toEqual({ worker: "refused", serviceWorker: "refused" });
    await expect
      .poll(() => security.violations.some((v) => v.startsWith("require-trusted-types-for")))
      .toBe(true);
  });

  test("no script can create another policy, or this one a second time", async ({
    page,
    security,
  }) => {
    security.expectRefusals();
    await open(page);
    const results = await page.evaluate((workerPolicy) => {
      const { platform } = window;
      // TypeScript's DOM types do not describe Trusted Types yet.
      const { trustedTypes } = globalThis as typeof globalThis & {
        trustedTypes?: { createPolicy: (name: string, rules: object) => unknown };
      };
      if (platform === undefined || trustedTypes === undefined) {
        throw new Error("The test app has not loaded, or the browser lacks Trusted Types.");
      }
      // Starting a worker creates the policy.
      platform.startWorker(platform.pingWorker).terminate();
      const outcomes: Record<string, string> = {};
      for (const name of [workerPolicy, "default", "other"]) {
        try {
          trustedTypes.createPolicy(name, { createScriptURL: (input: string) => input });
          outcomes[name] = "created";
        } catch {
          outcomes[name] = "refused";
        }
      }
      return outcomes;
    }, WORKER_POLICY);
    expect(results).toEqual({ [WORKER_POLICY]: "refused", default: "refused", other: "refused" });
  });

  test("DOM injection sinks still refuse strings", async ({ page, security }) => {
    security.expectRefusals();
    await open(page);
    const injections: Record<string, () => unknown> = {
      "script.src": () => {
        document.createElement("script").src = "/sw.js";
      },
      "iframe.srcdoc": () => {
        document.createElement("iframe").srcdoc = "<p>x</p>";
      },
      "DOMParser.parseFromString()": () => new DOMParser().parseFromString("<p>x</p>", "text/html"),
    };
    for (const [sink, inject] of Object.entries(injections)) {
      await expect(page.evaluate(inject), sink).rejects.toThrow();
    }
  });
});
