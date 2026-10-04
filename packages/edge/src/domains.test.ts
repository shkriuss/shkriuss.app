import { describe, expect, it } from "vitest";
import {
  PRODUCTION_DOMAIN,
  RESERVED_IDS,
  STAGING_DOMAIN,
  appHost,
  assertAppId,
} from "./domains.ts";

describe("appHost", () => {
  it("serves the hub at the apex and apps on their subdomain", () => {
    expect(appHost(PRODUCTION_DOMAIN)).toBe("shkriuss.app");
    expect(appHost(STAGING_DOMAIN)).toBe("shkriuss.dev");
    expect(appHost(PRODUCTION_DOMAIN, "notes")).toBe("notes.shkriuss.app");
    expect(appHost(STAGING_DOMAIN, "notes")).toBe("notes.shkriuss.dev");
  });
});

describe("assertAppId", () => {
  it.each(["notes", "a", "habit-tracker", "x2"])("accepts %s", (id) => {
    expect(() => assertAppId(id)).not.toThrow();
  });

  it.each(["", "Notes", "-notes", "notes-", "my.notes", "my_notes", "a".repeat(64)])(
    "rejects %j, which is not a single lowercase DNS label",
    (id) => {
      expect(() => assertAppId(id)).toThrow(/not a valid app id/);
    },
  );

  it.each(RESERVED_IDS)("rejects the reserved name %s", (id) => {
    expect(() => assertAppId(id)).toThrow(/reserved/);
  });
});
