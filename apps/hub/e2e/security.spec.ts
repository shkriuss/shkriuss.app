import { cspHashSource, securityHeaders } from "@shkriuss/edge";
import type { ConsoleMessage, Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";

const IMPORT_MAP = /<script type="importmap">(.*?)<\/script>/s;

/** The URL paths that the page's import map lists, i.e. every script of the build. */
function scriptPaths(html: string): string[] {
  const importMap = IMPORT_MAP.exec(html)?.[1];
  if (importMap === undefined) {
    throw new Error("The page has no import map.");
  }
  const parsed: unknown = JSON.parse(importMap);
  if (typeof parsed !== "object" || parsed === null || !("integrity" in parsed)) {
    throw new Error("The import map has no integrity section.");
  }
  const integrity: unknown = parsed.integrity;
  if (typeof integrity !== "object" || integrity === null) {
    throw new Error("The import map's integrity section is not an object.");
  }
  return Object.keys(integrity);
}

test.describe("response headers", () => {
  for (const path of ["/", "/some/unknown/path"]) {
    test(`${path} carries the full security policy`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const importMap = IMPORT_MAP.exec(await response.text())?.[1] ?? "";
      const headers = response.headers();
      for (const [name, value] of securityHeaders({ scriptHashes: [cspHashSource(importMap)] })) {
        expect(headers[name.toLowerCase()], name).toBe(value);
      }
    });
  }

  test("hashed assets are cached for a year, the page is revalidated", async ({ request }) => {
    const page = await request.get("/");
    expect(page.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
    for (const path of scriptPaths(await page.text())) {
      const asset = await request.get(path);
      expect(asset.status(), path).toBe(200);
      expect(asset.headers()["cache-control"], path).toBe("public, max-age=31536000, immutable");
    }
  });
});

/** Serves the files that match `pattern` with one line of code added at the end. */
async function tamperWith(page: Page, pattern: RegExp): Promise<void> {
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.tampered = 1;` });
  });
}

/** Whether the browser runs the module at `url` when the page imports it. */
async function importModule(page: Page, url: string): Promise<string> {
  return page.evaluate(
    async (target) =>
      import(target).then(
        () => "loaded",
        () => "refused",
      ),
    url,
  );
}

/**
 * Whether a console message logs a `TypeError`, as React logs the error that a boundary caught,
 * such as a refused import's. The browsers word that error differently, and Playwright gives a
 * logged object's text as only "Error" in Firefox, so this looks at the logged object itself.
 */
async function logsTypeError(message: ConsoleMessage): Promise<boolean> {
  if (message.type() !== "error") {
    return false;
  }
  const [logged] = message.args();
  return (await logged?.evaluate((value) => value instanceof TypeError)) ?? false;
}

async function scriptPath(page: Page, name: string): Promise<string> {
  const path = scriptPaths(await page.content()).find((candidate) =>
    candidate.startsWith(`/assets/${name}-`),
  );
  if (path === undefined) {
    throw new Error(`The build has no ${name} chunk.`);
  }
  return path;
}

test.describe("script integrity", () => {
  test("every script loads without a CSP, Trusted Types or integrity problem", async ({ page }) => {
    await page.goto("/security");
    // The lazily loaded chunk has arrived; the security fixture checks the browser's reports.
    await expect(
      page.getByRole("heading", { level: 2, name: "Check what a site serves" }),
    ).toBeVisible();
  });

  test("an entry script whose content changed is refused", async ({ page, security }) => {
    security.expectRefusals();
    await tamperWith(page, /\/assets\/index-[^/]+\.js$/);
    await page.goto("/");
    expect(await importModule(page, await scriptPath(page, "index"))).toBe("refused");
    expect(await page.evaluate(() => "tampered" in globalThis)).toBe(false);
    await expect(page.getByRole("heading")).toHaveCount(0);
  });

  test("a lazily loaded script whose content changed is refused", async ({ page, security }) => {
    security.expectRefusals();
    await tamperWith(page, /\/assets\/Verification-[^/]+\.js$/);
    // Every browser rejects the page's own import of the chunk with a TypeError, which React
    // logs once a boundary has caught it: only then does the page show what it is left with.
    const refused = page.waitForEvent("console", logsTypeError);
    await page.goto("/security");
    await refused;
    expect(await importModule(page, await scriptPath(page, "Verification"))).toBe("refused");
    expect(await page.evaluate(() => "tampered" in globalThis)).toBe(false);
    // The rest of the page still works, without the section.
    await expect(page.getByRole("heading", { level: 1, name: "Security" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "How the apps are protected",
      "Report a problem",
    ]);
  });

  test("a script without an integrity hash is refused", async ({ page, security }) => {
    security.expectRefusals();
    await page.route("**/assets/injected.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: "globalThis.injected = 1;" }),
    );
    await page.goto("/");
    expect(await importModule(page, "/assets/injected.js")).toBe("refused");
    expect(await page.evaluate(() => "injected" in globalThis)).toBe(false);
  });
});

test.describe("Trusted Types", () => {
  test("DOM injection sinks refuse strings", async ({ page, security }) => {
    security.expectRefusals();
    await page.goto("/");
    const injections: Record<string, () => unknown> = {
      "DOMParser.parseFromString()": () => new DOMParser().parseFromString("<p>x</p>", "text/html"),
      "iframe.srcdoc": () => {
        document.createElement("iframe").srcdoc = "<p>x</p>";
      },
      "script.src": () => {
        document.createElement("script").src = "/assets/injected.js";
      },
    };
    // None of these throw without Trusted Types. Browsers word the error differently.
    for (const [sink, inject] of Object.entries(injections)) {
      await expect(page.evaluate(inject), sink).rejects.toThrow();
    }
    await expect
      .poll(() => security.violations.some((v) => v.startsWith("require-trusted-types-for")))
      .toBe(true);
  });

  test("no script can create a policy to get around them", async ({ page, security }) => {
    security.expectRefusals();
    await page.goto("/");
    const createPolicy = page.evaluate(() => {
      // TypeScript's DOM types do not describe Trusted Types yet.
      const { trustedTypes } = globalThis as typeof globalThis & {
        trustedTypes?: { createPolicy: (name: string, rules: object) => unknown };
      };
      if (trustedTypes === undefined) {
        throw new Error("This browser does not support Trusted Types.");
      }
      trustedTypes.createPolicy("bypass", {});
    });
    await expect(createPolicy).rejects.toThrow();
  });

  test("inline scripts never run", async ({ page, security }) => {
    security.expectRefusals();
    await page.goto("/");
    const ran = await page.evaluate(async () => {
      const script = document.createElement("script");
      try {
        script.textContent = "globalThis.inline = 1;";
        document.head.append(script);
      } catch {
        // Trusted Types refused the assignment.
      }
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
      return "inline" in globalThis;
    });
    expect(ran).toBe(false);
  });
});
