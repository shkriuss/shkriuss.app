import { describe, expect, it, vi } from "vitest";
import { loading } from "./on-demand.ts";

describe("loading", () => {
  it("starts once, and keeps what loaded", async () => {
    const load = vi.fn<() => Promise<string>>(async () => "component");
    const settings = loading(load);
    expect(settings.loaded()).toBeUndefined();
    const first = settings.start();
    expect(settings.start()).toBe(first);
    await expect(first).resolves.toBe("component");
    expect(settings.loaded()).toBe("component");
    await expect(settings.load()).resolves.toBe("component");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a loading that failed, so that a render finds it failed rather than loading again", async () => {
    const load = vi.fn<() => Promise<string>>(async () => {
      throw new Error("The network is away.");
    });
    const settings = loading(load);
    const first = settings.start();
    await expect(first).rejects.toThrow("The network is away.");
    // Each render would otherwise ask for the file again, five times before the boundary shows.
    expect(settings.start()).toBe(first);
    expect(settings.start()).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    expect(settings.loaded()).toBeUndefined();
  });

  it("tries again when asked to, after a failure, and not before", async () => {
    let attempts = 0;
    const load = vi.fn<() => Promise<string>>(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("The network is away.");
      }
      return "component";
    });
    const settings = loading(load);
    // Before any failure, a retry changes nothing.
    settings.retry();
    const first = settings.start();
    expect(settings.start()).toBe(first);
    await expect(first).rejects.toThrow("The network is away.");
    await expect(settings.load()).resolves.toBe("component");
    expect(settings.loaded()).toBe("component");
    expect(load).toHaveBeenCalledTimes(2);
    // The next render finds it loaded.
    await expect(settings.start()).resolves.toBe("component");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("lets the user's next action try again, from the failed loading", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("The network is away."))
      .mockResolvedValueOnce("dialog");
    const dialog = loading(load);
    await expect(dialog.start()).rejects.toThrow("The network is away.");
    dialog.retry();
    await expect(dialog.start()).resolves.toBe("dialog");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("awaits a loading under way rather than starting another", async () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const load = vi.fn<() => Promise<string>>(() => promise);
    const settings = loading(load);
    const started = settings.start();
    const loaded = settings.load();
    resolve("component");
    await expect(started).resolves.toBe("component");
    await expect(loaded).resolves.toBe("component");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
