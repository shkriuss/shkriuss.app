import { describe, expect, it } from "vitest";
import {
  DENIED_FEATURES,
  contentSecurityPolicy,
  permissionsPolicy,
  securityHeaders,
} from "./headers.ts";

const HASH = "'sha256-GRc6Nm15BkLoEye0zzztI4Lk2XalJU7mN5ackOE8koM='";

describe("contentSecurityPolicy", () => {
  it("is the strict policy from the architecture, with the import map's hash", () => {
    expect(contentSecurityPolicy([HASH])).toBe(
      "default-src 'none'; " +
        `script-src 'self' ${HASH}; ` +
        "style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; " +
        "manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; " +
        "frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
    );
  });

  it("allows only same-origin scripts when there is no hash", () => {
    expect(contentSecurityPolicy([])).toContain("script-src 'self'; ");
  });

  it.each([
    "'unsafe-inline'",
    "'unsafe-eval'",
    "https://cdn.example",
    "*",
    "",
    HASH.slice(1, -1),
    `${HASH}; script-src *`,
  ])("refuses %j as an extra script source; only hash sources are allowed", (source) => {
    expect(() => contentSecurityPolicy([source])).toThrow(/not a CSP hash source/);
  });
});

describe("permissionsPolicy", () => {
  it("denies every listed feature", () => {
    const policy = permissionsPolicy();
    for (const feature of DENIED_FEATURES) {
      expect(policy).toContain(`${feature}=()`);
    }
    expect(policy.split(", ")).toHaveLength(DENIED_FEATURES.length);
  });

  it("allows an opted-in feature for the app's own origin only", () => {
    const policy = permissionsPolicy(["camera"]);
    expect(policy).toContain("camera=(self)");
    expect(policy).not.toContain("camera=()");
    expect(policy).toContain("microphone=()");
  });

  it("leaves web-share at its default, so backups can use the share sheet", () => {
    expect(permissionsPolicy()).not.toContain("web-share");
  });

  it("lists each feature once", () => {
    expect(new Set(DENIED_FEATURES).size).toBe(DENIED_FEATURES.length);
  });
});

describe("securityHeaders", () => {
  it("sets every header from the architecture once", () => {
    const headers = securityHeaders({ scriptHashes: [HASH] });
    expect(headers.map(([name]) => name)).toEqual([
      "Content-Security-Policy",
      "Integrity-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Embedder-Policy",
      "Cross-Origin-Resource-Policy",
      "Strict-Transport-Security",
      "Referrer-Policy",
      "Permissions-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]);
    expect(Object.fromEntries(headers)).toMatchObject({
      "Integrity-Policy": "blocked-destinations=(script)",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
  });
});
