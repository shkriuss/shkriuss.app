import { PRODUCTION_DOMAIN, STAGING_DOMAIN } from "@shkriuss/edge/domains";
import { describe, expect, it } from "vitest";
import type { CatalogApp } from "./catalog.ts";
import { listedApps } from "./listed.ts";

function app(id: string, released: boolean): CatalogApp {
  return {
    id,
    name: id,
    description: "An app.",
    icon: "data:image/svg+xml,",
    allowedFeatures: [],
    keepsData: true,
    released,
  };
}

const APPS = [app("checklists", true), app("notes", false), app("grammar", true)];

describe("listedApps (ADR 0015)", () => {
  it("lists only the released apps in production, in their order", () => {
    expect(listedApps(APPS, PRODUCTION_DOMAIN).map(({ id }) => id)).toEqual([
      "checklists",
      "grammar",
    ]);
  });

  it("lists every app elsewhere: on staging, and on the computer that tests it", () => {
    expect(listedApps(APPS, STAGING_DOMAIN)).toEqual(APPS);
    expect(listedApps(APPS, "127.0.0.1")).toEqual(APPS);
    expect(listedApps(APPS, `www.${PRODUCTION_DOMAIN}`)).toEqual(APPS);
  });
});
