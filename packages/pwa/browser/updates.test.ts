import { describe, expect, it, vi } from "vitest";
import { ACTIVATE_MESSAGE } from "../src/protocol.ts";
import { FakeCaches, FakeContainer, FakePage, FakeWorker, settle } from "./test/fakes.ts";
import { type AppUpdates, createAppUpdates, UPDATE_CHECK_INTERVAL } from "./updates.ts";

/** A page of an app that a version controls, with that version active, once it has loaded. */
async function controlledPage(): Promise<{
  page: FakePage;
  container: FakeContainer;
  updates: AppUpdates;
}> {
  const container = new FakeContainer({ controlled: true });
  const page = new FakePage({ container });
  page.registration.active = new FakeWorker("activated");
  const updates = createAppUpdates(page, "serve");
  await page.finishLoading();
  return { page, container, updates };
}

/** The states that `updates` goes through from now on. */
function states(updates: AppUpdates): string[] {
  const seen: string[] = [];
  updates.subscribe(() => {
    seen.push(updates.getState());
  });
  return seen;
}

/** A page whose first version failed to install, which leaves the browser no worker. */
async function failedPage(): Promise<{ page: FakePage; updates: AppUpdates; seen: string[] }> {
  const page = new FakePage({ container: new FakeContainer({ controlled: false }) });
  page.registration.installing = new FakeWorker("installing");
  const updates = createAppUpdates(page, "serve");
  await page.finishLoading();
  const seen = states(updates);
  page.registration.failed();
  return { page, updates, seen };
}

describe("registration (§3)", () => {
  it("registers nothing without service workers, as in development builds", async () => {
    const page = new FakePage({ container: undefined });
    const updates = createAppUpdates(page, "serve");
    await page.finishLoading();
    expect(page.register).not.toHaveBeenCalled();
    expect(updates.getState()).toBe("unavailable");
    await updates.checkForUpdate();
    expect(page.registration.update).not.toHaveBeenCalled();
  });

  it("registers once the page has loaded, and shows the first version installing", async () => {
    const page = new FakePage({ container: new FakeContainer({ controlled: false }) });
    page.registration.installing = new FakeWorker("installing");
    const updates = createAppUpdates(page, "serve");
    const seen = states(updates);
    await settle();
    expect(page.register).not.toHaveBeenCalled();
    // Until then, the page does not know yet whether the app works offline.
    expect(updates.getState()).toBe("starting");
    await page.finishLoading();
    expect(page.register).toHaveBeenCalledOnce();
    expect(updates.getState()).toBe("installing");
    expect(seen).toStrictEqual(["installing"]);
  });

  it("becomes unavailable when the browser refuses the service worker", async () => {
    const page = new FakePage({ container: new FakeContainer({ controlled: false }) });
    page.register.mockRejectedValueOnce(
      new DOMException("Not in a private window.", "SecurityError"),
    );
    const updates = createAppUpdates(page, "serve");
    expect(updates.getState()).toBe("starting");
    const seen = states(updates);
    await page.finishLoading();
    expect(updates.getState()).toBe("unavailable");
    expect(seen).toStrictEqual(["unavailable"]);
  });
});

describe("a first version that fails to install (§3)", () => {
  it("leaves the app online only, and registers again when the device comes back online", async () => {
    const { page, updates, seen } = await failedPage();
    // Not installing for ever: the app works online only, and its pages can start what they
    // waited for.
    expect(updates.getState()).toBe("unavailable");
    page.registration.installing = new FakeWorker("installing");
    await page.comeOnline(1);
    expect(page.register).toHaveBeenCalledTimes(2);
    page.registration.activated();
    expect(seen).toStrictEqual(["unavailable", "installing", "ready"]);
  });

  it("registers again once an hour has passed, as the page becomes visible or stays open", async () => {
    const { page } = await failedPage();
    await page.becomeVisible(30);
    await page.wait(29);
    expect(page.register).toHaveBeenCalledOnce();
    await page.becomeVisible(1);
    expect(page.register).toHaveBeenCalledTimes(2);
    // Failed again: the next try comes an hour after this one.
    await page.wait(59);
    expect(page.register).toHaveBeenCalledTimes(2);
    await page.wait(1);
    expect(page.register).toHaveBeenCalledTimes(3);
  });

  it("tries again when registering failed, as when /sw.js could not be fetched", async () => {
    const page = new FakePage({ container: new FakeContainer({ controlled: false }) });
    page.register.mockRejectedValueOnce(new TypeError("Failed to fetch."));
    page.registration.installing = new FakeWorker("installing");
    const updates = createAppUpdates(page, "serve");
    await page.finishLoading();
    expect(updates.getState()).toBe("unavailable");
    await page.comeOnline(5);
    expect(updates.getState()).toBe("installing");
  });

  it("registers nothing more once a version installs", async () => {
    const page = new FakePage({ container: new FakeContainer({ controlled: false }) });
    page.registration.installing = new FakeWorker("installing");
    createAppUpdates(page, "serve");
    await page.finishLoading();
    await page.comeOnline(90);
    await page.wait(120);
    expect(page.register).toHaveBeenCalledOnce();
  });
});

describe("the first version (§5)", () => {
  it("makes the app ready once it is active, and its control of the page is no update", async () => {
    const container = new FakeContainer({ controlled: false });
    const page = new FakePage({ container });
    page.registration.installing = new FakeWorker("installing");
    const updates = createAppUpdates(page, "serve");
    await page.finishLoading();
    const seen = states(updates);
    page.registration.activated();
    container.takeOver();
    // Ready once active; the listener hears again when the version takes control, not as a
    // change of state (it stays ready) but of `controlled()`.
    expect(seen).toStrictEqual(["ready", "ready"]);
    expect(page.reload).not.toHaveBeenCalled();
  });
});

describe("control of the page (§5)", () => {
  it("is false until the first version takes control, which listeners hear", async () => {
    const container = new FakeContainer({ controlled: false });
    const page = new FakePage({ container });
    page.registration.installing = new FakeWorker("installing");
    const updates = createAppUpdates(page, "serve");
    await page.finishLoading();
    const listener = vi.fn<() => void>();
    updates.subscribe(listener);
    page.registration.activated();
    // Active, so ready, but the page is not controlled until the version claims it.
    expect(updates.getState()).toBe("ready");
    expect(updates.controlled()).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    container.takeOver();
    expect(updates.controlled()).toBe(true);
    expect(updates.getState()).toBe("ready");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("is true from the start for a page that a version controls, and stays so when another takes over", async () => {
    const { container, updates } = await controlledPage();
    expect(updates.controlled()).toBe(true);
    container.takeOver();
    expect(updates.controlled()).toBe(true);
    expect(updates.getState()).toBe("outdated");
  });

  it("is false without service workers, and in a build that removes them", async () => {
    expect(createAppUpdates(new FakePage({ container: undefined }), "serve").controlled()).toBe(
      false,
    );
    const container = new FakeContainer({ controlled: true });
    expect(createAppUpdates(new FakePage({ container }), "remove").controlled()).toBe(false);
  });
});

describe("a change of controller before the page has loaded", () => {
  it("counts once the page has registered", async () => {
    const container = new FakeContainer({ controlled: false });
    const page = new FakePage({ container });
    page.registration.active = new FakeWorker("activated");
    const updates = createAppUpdates(page, "serve");
    // The first version takes control before the page has loaded: not an update.
    container.takeOver();
    expect(updates.getState()).toBe("starting");
    await page.finishLoading();
    expect(updates.getState()).toBe("ready");
    // Now that a version controls the page, the next one is an update.
    container.takeOver();
    expect(updates.getState()).toBe("outdated");
  });
});

describe("updates (§7)", () => {
  it("shows a new version once it has installed and waits", async () => {
    const { page, updates } = await controlledPage();
    expect(updates.getState()).toBe("ready");
    const seen = states(updates);
    page.registration.found();
    expect(updates.getState()).toBe("ready");
    page.registration.installed();
    expect(seen).toStrictEqual(["update-available"]);
  });

  it("shows a new version that already waited when the page loaded", async () => {
    const page = new FakePage({ container: new FakeContainer({ controlled: true }) });
    page.registration.active = new FakeWorker("activated");
    page.registration.waiting = new FakeWorker("installed");
    const updates = createAppUpdates(page, "serve");
    await page.finishLoading();
    expect(updates.getState()).toBe("update-available");
  });

  it("stops showing a waiting version that has gone", async () => {
    const page = new FakePage({ container: new FakeContainer({ controlled: true }) });
    page.registration.active = new FakeWorker("activated");
    const waiting = new FakeWorker("installed");
    page.registration.waiting = waiting;
    const updates = createAppUpdates(page, "serve");
    await page.finishLoading();
    expect(updates.getState()).toBe("update-available");
    page.registration.waiting = null;
    waiting.become("redundant");
    expect(updates.getState()).toBe("ready");
  });

  it("stays ready when a new version fails to install", async () => {
    const { page, updates } = await controlledPage();
    const seen = states(updates);
    const failed = page.registration.found();
    page.registration.installing = null;
    failed.become("redundant");
    expect(updates.getState()).toBe("ready");
    expect(seen).toStrictEqual([]);
  });

  it("makes the waiting version active when the user agrees, then reloads into it", async () => {
    const { page, container, updates } = await controlledPage();
    page.registration.found();
    page.registration.installed();
    const waiting = page.registration.waiting;
    updates.applyUpdate();
    expect(waiting?.postMessage).toHaveBeenCalledWith(ACTIVATE_MESSAGE, []);
    expect(updates.getState()).toBe("updating");
    // Asking twice sends nothing more.
    updates.applyUpdate();
    expect(waiting?.postMessage).toHaveBeenCalledOnce();
    page.registration.activated();
    expect(page.reload).not.toHaveBeenCalled();
    container.takeOver();
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it("applies nothing when no version waits", async () => {
    const { page, updates } = await controlledPage();
    updates.applyUpdate();
    expect(updates.getState()).toBe("ready");
    expect(page.registration.active?.postMessage).not.toHaveBeenCalled();
  });

  it("offers the newer version when another one replaces the version it was applying", async () => {
    const { page, updates } = await controlledPage();
    page.registration.found();
    page.registration.installed();
    const replaced = page.registration.waiting;
    updates.applyUpdate();
    page.registration.found();
    page.registration.installed();
    replaced?.become("redundant");
    expect(updates.getState()).toBe("update-available");
    updates.applyUpdate();
    expect(page.registration.waiting?.postMessage).toHaveBeenCalledWith(ACTIVATE_MESSAGE, []);
  });

  it("asks a page that another window updated to reload, and only asks", async () => {
    const { page, container, updates } = await controlledPage();
    page.registration.found();
    page.registration.installed();
    page.registration.activated();
    container.takeOver();
    expect(updates.getState()).toBe("outdated");
    // Nothing that follows can make it current again.
    page.registration.found();
    page.registration.installed();
    expect(updates.getState()).toBe("outdated");
    expect(page.reload).not.toHaveBeenCalled();
    // When the user agrees, it reloads into the active version.
    updates.applyUpdate();
    expect(page.registration.waiting?.postMessage).not.toHaveBeenCalled();
    expect(page.reload).toHaveBeenCalledOnce();
  });
});

describe("checking for a new version (§7.1)", () => {
  it("asks the browser when the page becomes visible, at most once an hour", async () => {
    const { page } = await controlledPage();
    const hour = UPDATE_CHECK_INTERVAL / 60_000;
    await page.becomeVisible(hour - 1);
    expect(page.registration.update).not.toHaveBeenCalled();
    await page.becomeVisible(1);
    expect(page.registration.update).toHaveBeenCalledOnce();
    await page.becomeVisible(hour - 1);
    expect(page.registration.update).toHaveBeenCalledOnce();
    await page.becomeVisible(1);
    expect(page.registration.update).toHaveBeenCalledTimes(2);
  });

  it("asks every hour while the page stays open, and when the device comes back online", async () => {
    const { page } = await controlledPage();
    await page.wait(59);
    expect(page.registration.update).not.toHaveBeenCalled();
    await page.wait(1);
    expect(page.registration.update).toHaveBeenCalledOnce();
    await page.comeOnline(30);
    expect(page.registration.update).toHaveBeenCalledOnce();
    await page.comeOnline(30);
    expect(page.registration.update).toHaveBeenCalledTimes(2);
    expect(page.register).toHaveBeenCalledOnce();
  });

  it("checks when asked, and a failed check waits for the next one", async () => {
    const { page, updates } = await controlledPage();
    page.registration.update.mockRejectedValueOnce(new TypeError("Offline."));
    await expect(updates.checkForUpdate()).resolves.toBeUndefined();
    expect(updates.getState()).toBe("ready");
    // It counts as the hour's check.
    await page.becomeVisible(59);
    expect(page.registration.update).toHaveBeenCalledOnce();
  });
});

describe("subscribe", () => {
  it("calls a listener after each change, until it unsubscribes", async () => {
    const { page, updates } = await controlledPage();
    const listener = vi.fn<() => void>();
    const unsubscribe = updates.subscribe(listener);
    page.registration.found();
    page.registration.installed();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    updates.applyUpdate();
    expect(listener).toHaveBeenCalledOnce();
  });
});

/** A page whose Cache Storage has the record of a first use (§6.3), or not. */
function recordingPage(recorded: boolean, container: FakeContainer | undefined): FakePage {
  const caches = new FakeCaches(["pwa-state"]);
  if (recorded) {
    caches.kept.set("pwa-state", new Set(["/pwa-first-use.json"]));
  }
  return new FakePage({ container, caches });
}

function controlled(): FakeContainer {
  return new FakeContainer({ controlled: true });
}

describe("files kept on first use (§6.3)", () => {
  it("says whether the service worker records that the app has kept one", async () => {
    expect(await createAppUpdates(recordingPage(true, controlled()), "serve").firstUseKept()).toBe(
      true,
    );
    expect(await createAppUpdates(recordingPage(false, controlled()), "serve").firstUseKept()).toBe(
      false,
    );
  });

  it("says no without service workers, in a build that removes them, and when Cache Storage fails", async () => {
    // A browser without service workers, or a development build.
    expect(await createAppUpdates(recordingPage(true, undefined), "serve").firstUseKept()).toBe(
      false,
    );
    expect(await createAppUpdates(recordingPage(true, controlled()), "remove").firstUseKept()).toBe(
      false,
    );
    const withoutCaches = new FakePage({ container: controlled(), caches: undefined });
    expect(await createAppUpdates(withoutCaches, "serve").firstUseKept()).toBe(false);
    const damaged = recordingPage(true, controlled());
    if (damaged.caches !== undefined) {
      damaged.caches.damaged = true;
    }
    expect(await createAppUpdates(damaged, "serve").firstUseKept()).toBe(false);
  });
});

describe("a build that removes the service worker (§9)", () => {
  it("registers none, and unregisters every one it finds and deletes their caches", async () => {
    const container = new FakeContainer({ controlled: true });
    const caches = new FakeCaches(["pwa-aaaaaaaaaaaaaaaa", "pwa-state", "another-cache"]);
    const page = new FakePage({ container, caches });
    const updates = createAppUpdates(page, "remove");
    await settle();
    expect(page.register).not.toHaveBeenCalled();
    for (const registration of container.registrations) {
      expect(registration.unregister).toHaveBeenCalledOnce();
    }
    expect(caches.names).toStrictEqual(["another-cache"]);
    expect(updates.getState()).toBe("unavailable");
  });

  it("unregisters them where the browser has no Cache Storage", async () => {
    const container = new FakeContainer({ controlled: true });
    const page = new FakePage({ container, caches: undefined });
    createAppUpdates(page, "remove");
    await settle();
    for (const registration of container.registrations) {
      expect(registration.unregister).toHaveBeenCalledOnce();
    }
  });

  it("gives up quietly when the browser refuses", async () => {
    const container = new FakeContainer({ controlled: true });
    container.getRegistrations.mockRejectedValueOnce(new DOMException("No.", "InvalidStateError"));
    const caches = new FakeCaches(["pwa-state"]);
    createAppUpdates(new FakePage({ container, caches }), "remove");
    await settle();
    expect(caches.delete).not.toHaveBeenCalled();
  });
});
