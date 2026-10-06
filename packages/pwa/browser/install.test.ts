import { describe, expect, it, vi } from "vitest";
import { type AppInstall, createAppInstall, type InstallPromptLike } from "./install.ts";

/** `matchMedia("(display-mode: standalone)")`, whose answer the test sets. */
class FakeMedia {
  matches: boolean;
  readonly #listeners = new Set<() => void>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(_type: string, listener: () => void): void {
    this.#listeners.add(listener);
  }

  set(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

/** Chromium's `beforeinstallprompt`, with the user's answer that the test gives. */
class FakePrompt extends Event implements InstallPromptLike {
  readonly answer = Promise.withResolvers<{ outcome: string }>();
  readonly prompt = vi.fn<() => Promise<unknown>>(async () => undefined);

  constructor() {
    super("beforeinstallprompt", { cancelable: true });
  }

  get userChoice(): Promise<{ outcome: string }> {
    return this.answer.promise;
  }
}

function setup({
  standalone = false,
  homeScreen,
}: { standalone?: boolean; homeScreen?: boolean } = {}): {
  install: AppInstall;
  media: FakeMedia;
  window: EventTarget;
  changes: () => number;
} {
  const media = new FakeMedia(standalone);
  const window = new EventTarget();
  const install = createAppInstall({ standalone: media, homeScreen, window });
  let count = 0;
  install.subscribe(() => {
    count += 1;
  });
  return { install, media, window, changes: () => count };
}

describe("the install state", () => {
  it("is unavailable where the browser offers the page nothing", () => {
    expect(setup().install.getState()).toBe("unavailable");
  });

  it("is installed when the app runs installed, on any device", () => {
    expect(setup({ standalone: true }).install.getState()).toBe("installed");
    expect(setup({ homeScreen: true }).install.getState()).toBe("installed");
  });

  it("says to add the app to the home screen in a browser on iPhone or iPad", () => {
    expect(setup({ homeScreen: false }).install.getState()).toBe("add-to-home-screen");
  });

  it("follows the display mode, as when the app opens installed", () => {
    const { install, media, changes } = setup();
    media.set(true);
    expect(install.getState()).toBe("installed");
    expect(changes()).toBe(1);
    // Nothing that changes the state tells the listeners.
    media.set(true);
    expect(changes()).toBe(1);
  });

  it("stops telling a listener that unsubscribed", () => {
    const { install, media } = setup();
    const listener = vi.fn<() => void>();
    const unsubscribe = install.subscribe(listener);
    unsubscribe();
    media.set(true);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("the browser's install prompt", () => {
  it("is offered when the browser fires beforeinstallprompt, without the browser's own banner", () => {
    const { install, window, changes } = setup();
    const offer = new FakePrompt();
    window.dispatchEvent(offer);
    expect(install.getState()).toBe("promptable");
    expect(offer.defaultPrevented).toBe(true);
    expect(changes()).toBe(1);
  });

  it("ignores an event of that name that is no install prompt", () => {
    const { install, window } = setup();
    const event = new Event("beforeinstallprompt", { cancelable: true });
    window.dispatchEvent(event);
    expect(install.getState()).toBe("unavailable");
    expect(event.defaultPrevented).toBe(false);
  });

  it("shows when the user asks, and the app is installed when the user agrees", async () => {
    const { install, window } = setup();
    const offer = new FakePrompt();
    window.dispatchEvent(offer);
    const installing = install.install();
    expect(offer.prompt).toHaveBeenCalledOnce();
    offer.answer.resolve({ outcome: "accepted" });
    await expect(installing).resolves.toBe(true);
    // At once, before the browser says so with appinstalled.
    expect(install.getState()).toBe("installed");
    window.dispatchEvent(new Event("appinstalled"));
    expect(install.getState()).toBe("installed");
  });

  it("is spent once the user dismissed it, until the browser offers another", async () => {
    const { install, window } = setup();
    const first = new FakePrompt();
    window.dispatchEvent(first);
    const installing = install.install();
    first.answer.resolve({ outcome: "dismissed" });
    await expect(installing).resolves.toBe(false);
    // The browser's menu may still install the app, but the page has nothing to offer.
    expect(install.getState()).toBe("unavailable");
    await expect(install.install()).resolves.toBe(false);
    expect(first.prompt).toHaveBeenCalledOnce();
    window.dispatchEvent(new FakePrompt());
    expect(install.getState()).toBe("promptable");
  });

  it("shows once for two presses, and gives both the user's answer", async () => {
    const { install, window } = setup();
    const offer = new FakePrompt();
    window.dispatchEvent(offer);
    const first = install.install();
    const second = install.install();
    offer.answer.resolve({ outcome: "accepted" });
    await expect(Promise.all([first, second])).resolves.toStrictEqual([true, true]);
    expect(offer.prompt).toHaveBeenCalledOnce();
  });

  it("resolves to false when the browser refuses to show it", async () => {
    const { install, window } = setup();
    const offer = new FakePrompt();
    offer.prompt.mockRejectedValue(new DOMException("Not for a press.", "NotAllowedError"));
    window.dispatchEvent(offer);
    await expect(install.install()).resolves.toBe(false);
    expect(install.getState()).toBe("unavailable");
  });

  it("resolves to false at once without an offer", async () => {
    const { install } = setup({ homeScreen: false });
    await expect(install.install()).resolves.toBe(false);
    expect(install.getState()).toBe("add-to-home-screen");
  });

  it("knows when the app was installed from the browser's menu", () => {
    const { install, window } = setup();
    window.dispatchEvent(new Event("appinstalled"));
    expect(install.getState()).toBe("installed");
  });

  it("keeps a newer offer that came while an older prompt showed", async () => {
    const { install, window } = setup();
    const older = new FakePrompt();
    window.dispatchEvent(older);
    const installing = install.install();
    window.dispatchEvent(new FakePrompt());
    older.answer.resolve({ outcome: "dismissed" });
    await installing;
    expect(install.getState()).toBe("promptable");
  });
});
