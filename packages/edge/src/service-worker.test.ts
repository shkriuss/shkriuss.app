import { describe, expect, it } from "vitest";
import {
  SERVICE_WORKER_PLUGIN,
  type ServiceWorkerApi,
  serviceWorkerApi,
} from "./service-worker.ts";

const api: ServiceWorkerApi = {
  bundle: async () => ({ modules: [], script: () => "" }),
};

describe("serviceWorkerApi", () => {
  it("finds the service worker plugin's api among the plugins", () => {
    const plugins = [{ name: "vite:react" }, { name: SERVICE_WORKER_PLUGIN, api }];
    expect(serviceWorkerApi(plugins)).toBe(api);
  });

  it("finds none in a build without it", () => {
    expect(serviceWorkerApi([{ name: "vite:react", api: { bundle: 1 } }])).toBeUndefined();
  });

  it("refuses two of them, which would both write /sw.js", () => {
    const plugin = { name: SERVICE_WORKER_PLUGIN, api };
    expect(() => serviceWorkerApi([plugin, plugin])).toThrow("2 shkriuss:pwa plugins");
  });

  it.each([
    ["no api", undefined],
    ["an api without bundle()", { build: () => undefined }],
    ["a bundle that is not a function", { bundle: "sw.js" }],
  ])("refuses a plugin of that name with %s", (_case, other) => {
    expect(() => serviceWorkerApi([{ name: SERVICE_WORKER_PLUGIN, api: other }])).toThrow(
      "offers no service worker",
    );
  });
});
