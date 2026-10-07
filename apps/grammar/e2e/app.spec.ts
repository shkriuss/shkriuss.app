import http from "node:http";
import { AxeBuilder } from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";
import { m } from "../src/messages.ts";

// Grammar in real browsers (docs/specs/apps/grammar.md §6): its production build, with its real
// service worker and Harper in its worker, under the production security headers, which allow
// WebAssembly for it. The fixture fails every test on a CSP violation, an error or a failed
// request.

/** The app's name and what it does, as its messages say. */
const NAME = m.appName();
const DESCRIPTION = m.appDescription();

/** A text with a mistake of each of several kinds, which Harper finds. */
const SAMPLE =
  "This is an test. I has a apple, and their is a problem with teh car of the the man.";

/** The kinds of the sample's mistakes, as the list names them, in the order of the text. */
const SAMPLE_KINDS = ["Grammar", "Agreement", "Grammar", "Grammar", "Typo", "Repetition"];

/** Harper's module is 16 MB, which the browser takes seconds to compile, more so in CI. */
const STARTING = { timeout: 60_000 };

// Each test starts the checker, in a new browser context.
test.describe.configure({ timeout: 120_000 });

function field(page: Page): Locator {
  return page.getByRole("textbox", { name: "Text" });
}

/** The status that says how many mistakes there are. */
function found(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /mistakes? found|Getting|Checking/v });
}

function mistakes(page: Page): Locator {
  return page.getByRole("region", { name: "Mistakes" }).getByRole("listitem");
}

/** A mistake of the list, by the words that it quotes. */
function mistake(page: Page, words: string): Locator {
  return mistakes(page).filter({ has: page.locator("mark", { hasText: words }) });
}

/** Opens the app at `url`, and checks `text` once its checker is ready. */
async function check(page: Page, text: string, count: number, url = "/"): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await field(page).fill(text);
  await expect(found(page)).toHaveText(m.found(count), STARTING);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the app checks a text, with no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await check(page, SAMPLE, 6);
    await expect(page).toHaveTitle(NAME);
    const html = await (await page.request.get("/")).text();
    expect(html).toContain(`<title>${NAME}</title>`);
    expect(html).toContain(`<meta name="description" content="${DESCRIPTION}">`);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("the checker finds the mistakes of a text, each with its kind, its words and its fixes", async ({
  page,
}) => {
  await check(page, SAMPLE, 6);
  await expect(mistakes(page).getByRole("heading", { level: 3 })).toHaveText(SAMPLE_KINDS);
  await expect(mistakes(page).locator("mark")).toHaveText([
    "an",
    "has",
    "a",
    "their",
    "teh",
    "the the",
  ]);
  const their = mistake(page, "their");
  await expect(their).toContainText("Did you mean “there”?");
  // Harper suggests "there's" twice; the list offers it once.
  await expect(their.getByRole("button")).toHaveText([
    "Replace with “there”",
    "Replace with “there's”",
    "Show",
    "Ignore",
  ]);
  // The browser's own spelling checker, which may send the text to a server, is off.
  await expect(field(page)).toHaveAttribute("spellcheck", "false");
});

test("a fix changes the text and checks it again; the focus goes to the next mistake", async ({
  page,
  browserName,
}) => {
  await check(page, SAMPLE, 6);
  await mistake(page, "an").getByRole("button", { name: "Replace with “a”" }).click();
  await expect(field(page)).toHaveValue(SAMPLE.replace("an test", "a test"));
  await expect(found(page)).toHaveText(m.found(5));
  await expect(mistakes(page).first().getByRole("heading")).toBeFocused();
  await expect(mistakes(page).first().getByRole("heading")).toHaveText("Agreement");

  // With the keyboard: the fix of the focused mistake, then the last mistake, whose place none
  // takes, so the focus goes to the one before it.
  // WebKit moves to buttons with Option-Tab, as Safari does.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(page.getByRole("button", { name: "Replace with “have”" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(found(page)).toHaveText(m.found(4));
  await mistake(page, "the the").getByRole("button", { name: "Replace with “the”" }).click();
  await expect(found(page)).toHaveText(m.found(3));
  await expect(mistake(page, "teh").getByRole("heading")).toBeFocused();
  await expect(field(page)).toHaveValue(
    "This is a test. I have a apple, and their is a problem with teh car of the man.",
  );
});

test("Show selects a mistake's words in the field; Ignore hides it until they change", async ({
  page,
}) => {
  await check(page, SAMPLE, 6);
  await mistake(page, "teh").getByRole("button", { name: "Show" }).click();
  await expect(field(page)).toBeFocused();
  expect(
    await field(page).evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
  ).toBe("teh");

  await mistake(page, "teh").getByRole("button", { name: "Ignore" }).click();
  await expect(found(page)).toHaveText(m.found(5));
  await expect(mistake(page, "teh")).toHaveCount(0);
  await expect(mistake(page, "the the").getByRole("heading")).toBeFocused();
  // Text added elsewhere leaves it ignored; a change around its words brings it back.
  await field(page).fill(`Hello. ${SAMPLE}`);
  await expect(found(page)).toHaveText(m.found(5));
  await field(page).fill(SAMPLE.replace("teh car", "teh bus"));
  await expect(found(page)).toHaveText(m.found(6));
  await expect(mistake(page, "teh")).toHaveCount(1);
});

test("each variety of English spells its own way", async ({ page }) => {
  await check(page, "The colour of the sky.", 1);
  await expect(mistake(page, "colour")).toContainText("Spelling");
  const english = page.getByRole("combobox", { name: "English" });
  await expect(english).toHaveValue("american");
  await english.selectOption("British");
  await expect(found(page)).toHaveText(m.found(0));
  await field(page).fill("The color of the sky.");
  await expect(found(page)).toHaveText(m.found(1));
});

test.describe("in Britain", () => {
  test.use({ locale: "en-GB" });

  test("the variety of English starts from the browser's language", async ({ page }) => {
    await check(page, "The color of the sky.", 1);
    await expect(page.getByRole("combobox", { name: "English" })).toHaveValue("british");
  });
});

test("Copy puts the text on the clipboard, and says so", async ({ page, browserName }) => {
  await check(page, SAMPLE, 6);
  await page.getByRole("button", { name: "Copy" }).click();
  const said = page.getByRole("status").filter({ hasText: /copied|clipboard/v });
  if (browserName === "chromium") {
    await expect(said).toHaveText(m.copied());
    // The app may not read the clipboard (its Permissions-Policy allows writing only), but the
    // user may paste from it. Only Chromium pastes in tests.
    await field(page).fill("");
    await field(page).press("ControlOrMeta+V");
    await expect(field(page)).toHaveValue(SAMPLE);
  } else {
    // Firefox and WebKit may refuse the clipboard to a test: the app says what happened.
    await expect(said).toHaveText(new RegExp(`^(?:${m.copied()}|${m.copyFailed()})$`, "v"));
  }
});

test("Delete empties the field, and Undo brings the text back until the user types again", async ({
  page,
}) => {
  await check(page, SAMPLE, 6);
  const remove = page.getByRole("button", { name: m.delete(), exact: true });
  const undo = page.getByRole("button", { name: m.undo(), exact: true });
  await remove.click();
  await expect(field(page)).toHaveValue("");
  await expect(page.getByText(m.deleted())).toBeVisible();
  await expect(mistakes(page)).toHaveCount(0);

  // Undo takes Delete's place, with the keyboard too, and the focus stays on the button.
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(field(page)).toHaveValue(SAMPLE);
  await expect(page.getByText(m.undone())).toBeVisible();
  await expect(found(page)).toHaveText(m.found(6));
  await expect(remove).toBeFocused();

  // Once the user types, there is nothing to undo; with the field empty, nothing to delete.
  await remove.click();
  await field(page).fill("Hello");
  await expect(undo).toHaveCount(0);
  await field(page).fill("");
  await expect(remove).toBeDisabled();
});

test("it keeps nothing: no database, no storage, and no cache but the service worker's", async ({
  page,
}) => {
  await check(page, SAMPLE, 6);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await expect(field(page)).toHaveValue("");
  const stored = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map((database) => database.name),
    local: localStorage.length,
    session: sessionStorage.length,
    caches: await caches.keys(),
  }));
  expect(stored).toMatchObject({ databases: [], local: 0, session: 0 });
  expect(stored.caches.filter((name) => !name.startsWith("pwa-"))).toStrictEqual([]);
});

/** Requests that the network holds back until the test lets them through. */
interface Hold {
  /** Settles once the first of them has come. */
  readonly arrived: Promise<void>;
  /** Lets them through, and those that come later. */
  readonly release: () => void;
}

/** The way from the browser to the app's server, which a test can hold up or cut. */
interface Network {
  /** The app's address through this network, an origin of its own. */
  readonly url: string;
  /** From now on, holds back the requests whose path ends with `suffix`. */
  readonly hold: (suffix: string) => Hold;
  /** From now on, the network closes every connection instead of answering, as offline. */
  readonly cut: () => void;
  readonly close: () => Promise<void>;
}

/**
 * A proxy to the app's server at `target`, as tooling/pwa-e2e has. Playwright's
 * `context.setOffline()` cannot stand in for it: its WebKit then fails every load, even those
 * that the service worker answers.
 */
async function networkTo(target: string): Promise<Network> {
  const { hostname, port } = new URL(target);
  let up = true;
  let held:
    | { readonly suffix: string; readonly waiting: (() => void)[]; readonly came: () => void }
    | undefined;
  const server = http.createServer((request, response) => {
    if (!up) {
      request.socket.destroy();
      return;
    }
    function forward(): void {
      const upstream = http.request(
        {
          host: hostname,
          port,
          method: request.method,
          path: request.url,
          headers: request.headers,
        },
        (answer) => {
          response.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
          answer.pipe(response);
        },
      );
      upstream.on("error", () => {
        response.destroy();
      });
      request.pipe(upstream);
    }
    if (held !== undefined && request.url?.endsWith(held.suffix) === true) {
      held.waiting.push(forward);
      held.came();
      return;
    }
    forward();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The proxy listens on no port.");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    hold: (suffix) => {
      const waiting: (() => void)[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();
      held = { suffix, waiting, came: resolve };
      return {
        arrived: promise,
        release: () => {
          held = undefined;
          for (const forward of waiting) {
            forward();
          }
        },
      };
    },
    cut: () => {
      up = false;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

test("it works offline after the first visit, Harper's module included", async ({
  page,
  baseURL,
}) => {
  const network = await networkTo(baseURL ?? "");
  try {
    await check(page, SAMPLE, 6, network.url);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    network.cut();
    await check(page, "Their is a cat.", 1, network.url);
  } finally {
    await network.close();
  }
});

test("“Getting the checker ready…” shows only once there is text to check", async ({
  page,
  baseURL,
}) => {
  const network = await networkTo(baseURL ?? "");
  try {
    // Harper's module waits in the network, so that the checker cannot start until it comes.
    const harper = network.hold(".wasm");
    await page.goto(network.url);
    await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
    await harper.arrived;
    await expect(page.getByText(m.gettingReady())).toHaveCount(0);
    await field(page).fill(SAMPLE);
    await expect(found(page)).toHaveText(m.gettingReady());
    harper.release();
    await expect(found(page)).toHaveText(m.found(6), STARTING);
  } finally {
    await network.close();
  }
});

test("the settings have installing and About, and neither storage nor backups", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("region")).toHaveCount(2);
  const about = page.getByRole("region", { name: `About ${NAME}` });
  await expect(about).toContainText(DESCRIPTION);
  await expect(about).toContainText("This app keeps none of your data");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("says where to report a security problem, at /.well-known/security.txt", async ({
  request,
}) => {
  const response = await request.get("/.well-known/security.txt");
  expect(response.status()).toBe(200);
  expect(await response.text()).toMatch(
    /^Contact: https:\/\/github\.com\/shkriuss\/shkriuss\.app\/security\/advisories\/new$/m,
  );
});

test("the app's service worker keeps every file of the build, Harper's module included", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const kept = await page.evaluate(async () => {
    const sums = await (await fetch("/sha256sums.txt")).text();
    const files = sums
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/)[1] ?? "")
      .filter((file) => file !== "/sw.js");
    const missing: string[] = [];
    for (const file of files) {
      if ((await caches.match(file === "/index.html" ? "/" : file)) === undefined) {
        missing.push(file);
      }
    }
    return { missing, modules: files.filter((file) => file.endsWith(".wasm")).length };
  });
  expect(kept).toStrictEqual({ missing: [], modules: 1 });
});

test("an address that the app does not have says so, in the frame", async ({ page }) => {
  await page.goto("/nowhere");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: `Go to ${NAME}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeFocused();
});
