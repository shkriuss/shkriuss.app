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
    expect(seen).toStrictEqual(["ready"]);
    expect(page.reload).not.toHaveBeenCalled();
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
