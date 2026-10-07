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
    expect(contentSecurityPolicy({ scriptHashes: [HASH] })).toBe(
      "default-src 'none'; " +
        `script-src 'self' ${HASH}; ` +
        "style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; " +
        "manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; " +
        "frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
    );
  });

  it("allows only same-origin scripts when there is no hash", () => {
    expect(contentSecurityPolicy({ scriptHashes: [] })).toContain("script-src 'self'; ");
  });

  it("allows no Trusted Types policy unless the app has workers", () => {
    for (const policy of [
      contentSecurityPolicy({ scriptHashes: [HASH] }),
      contentSecurityPolicy({ scriptHashes: [HASH], workers: false }),
    ]) {
      expect(policy).toMatch(/; trusted-types 'none'$/);
    }
  });

  it("allows exactly the worker policy, once, for an app with workers (ADR 0011)", () => {
    const policy = contentSecurityPolicy({ scriptHashes: [HASH], workers: true });
    expect(policy).toBe(
      contentSecurityPolicy({ scriptHashes: [HASH] }).replace(
        "trusted-types 'none'",
        "trusted-types shkriuss-workers",
      ),
    );
    // Without 'allow-duplicates', nothing can create a second policy of the same name.
    expect(policy).not.toContain("allow-duplicates");
    expect(policy).toContain("require-trusted-types-for 'script'; ");
    expect(policy).toContain("worker-src 'self'; ");
  });

  it("allows WebAssembly only for an app that declares it, and nothing else with it (ADR 0014)", () => {
    for (const policy of [
      contentSecurityPolicy({ scriptHashes: [HASH] }),
      contentSecurityPolicy({ scriptHashes: [HASH], webAssembly: false }),
    ]) {
      expect(policy).not.toContain("wasm-unsafe-eval");
    }
    const policy = contentSecurityPolicy({ scriptHashes: [HASH], webAssembly: true });
    expect(policy).toBe(
      contentSecurityPolicy({ scriptHashes: [HASH] }).replace(
        "script-src 'self' ",
        "script-src 'self' 'wasm-unsafe-eval' ",
      ),
    );
    expect(policy).not.toContain("'unsafe-eval'");
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
    expect(() => contentSecurityPolicy({ scriptHashes: [source] })).toThrow(
      /not a CSP hash source/,
    );
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

  it("passes the workers option on to the Content-Security-Policy", () => {
    const csp = (workers: boolean): string | undefined =>
      Object.fromEntries(securityHeaders({ scriptHashes: [HASH], workers }))[
        "Content-Security-Policy"
      ];
    expect(csp(true)).toBe(contentSecurityPolicy({ scriptHashes: [HASH], workers: true }));
    expect(csp(false)).toBe(contentSecurityPolicy({ scriptHashes: [HASH] }));
  });

  it("passes the webAssembly option on to the Content-Security-Policy", () => {
    const csp = Object.fromEntries(securityHeaders({ scriptHashes: [HASH], webAssembly: true }))[
      "Content-Security-Policy"
    ];
    expect(csp).toBe(contentSecurityPolicy({ scriptHashes: [HASH], webAssembly: true }));
  });
});
