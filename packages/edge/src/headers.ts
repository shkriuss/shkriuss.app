/**
 * The response headers every app is served with (ADR 0007, architecture §12), written as a
 * Cloudflare `_headers` file. Nothing here is ever relaxed to make something work; change the
 * code instead, or propose an ADR.
 */

/**
 * Browser features that every app denies to itself. A feature that is not listed keeps its
 * default, which allows it for the app's own origin; `web-share` stays allowed that way
 * because backups use the share sheet. Apps opt in to more in their configuration.
 *
 * Only features that Chromium recognizes are listed; it ignores unknown names. Privacy
 * Sandbox features are left out: Chrome is retiring them, and they only matter to third-party
 * content, which we never load.
 */
export const DENIED_FEATURES = [
  "accelerometer",
  "autoplay",
  "camera",
  "captured-surface-control",
  "clipboard-read",
  "clipboard-write",
  "compute-pressure",
  "cross-origin-isolated",
  "deferred-fetch",
  "deferred-fetch-minimal",
  "digital-credentials-get",
  "display-capture",
  "encrypted-media",
  "fullscreen",
  "gamepad",
  "geolocation",
  "gyroscope",
  "hid",
  "identity-credentials-get",
  "idle-detection",
  "keyboard-map",
  "language-detector",
  "local-fonts",
  "local-network-access",
  "magnetometer",
  "microphone",
  "midi",
  "on-device-speech-recognition",
  "otp-credentials",
  "payment",
  "picture-in-picture",
  "publickey-credentials-create",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "storage-access",
  "summarizer",
  "sync-xhr",
  "translator",
  "usb",
  "window-management",
  "xr-spatial-tracking",
] as const;

export type BrowserFeature = (typeof DENIED_FEATURES)[number];

export interface HeaderOptions {
  /** CSP hash sources for the inline scripts the build generates: only the import map. */
  readonly scriptHashes: readonly string[];
  /** Browser features the app needs, allowed for its own origin only. */
  readonly allowedFeatures?: readonly BrowserFeature[];
}

/** One header, as a name and a value. */
export type Header = readonly [name: string, value: string];

const HASH_SOURCE = /^'sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}'$/;

export function contentSecurityPolicy(scriptHashes: readonly string[]): string {
  for (const hash of scriptHashes) {
    if (!HASH_SOURCE.test(hash)) {
      throw new Error(`"${hash}" is not a CSP hash source such as 'sha256-…'.`);
    }
  }
  const directives: readonly (readonly string[])[] = [
    ["default-src", "'none'"],
    ["script-src", "'self'", ...scriptHashes],
    ["style-src", "'self'"],
    ["img-src", "'self'", "blob:", "data:"],
    ["connect-src", "'self'"],
    ["manifest-src", "'self'"],
    ["worker-src", "'self'"],
    ["base-uri", "'none'"],
    ["form-action", "'none'"],
    ["frame-ancestors", "'none'"],
    ["require-trusted-types-for", "'script'"],
    ["trusted-types", "'none'"],
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}

export function permissionsPolicy(allowedFeatures: readonly BrowserFeature[] = []): string {
  const allowed = new Set<string>(allowedFeatures);
  return DENIED_FEATURES.map((feature) =>
    allowed.has(feature) ? `${feature}=(self)` : `${feature}=()`,
  ).join(", ");
}

/** The security headers for every response, in the order they are written. */
export function securityHeaders(options: HeaderOptions): Header[] {
  return [
    ["Content-Security-Policy", contentSecurityPolicy(options.scriptHashes)],
    ["Integrity-Policy", "blocked-destinations=(script)"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
    ["Cross-Origin-Embedder-Policy", "require-corp"],
    ["Cross-Origin-Resource-Policy", "same-origin"],
    ["Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"],
    ["Referrer-Policy", "no-referrer"],
    ["Permissions-Policy", permissionsPolicy(options.allowedFeatures)],
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
  ];
}
