/**
 * Security headers for every site, written to dist/_headers at build time.
 * Cloudflare serves them with every static file.
 *
 * Change a header here and every site gets it on its next deploy.
 * Docs: docs/adr/0004-security-headers.md
 */

/**
 * Browser features an app may turn on (everything is off by default). A
 * browser ignores a name it doesn't know, so newer ones can be listed before
 * every browser has them (audit 5 C-3).
 */
export const PERMISSION_FEATURES = [
  'accelerometer',
  'ambient-light-sensor',
  'attribution-reporting',
  'autoplay',
  'battery',
  'bluetooth',
  'browsing-topics',
  'camera',
  'compute-pressure',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'identity-credentials-get',
  'idle-detection',
  'join-ad-interest-group',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'otp-credentials',
  'payment',
  'picture-in-picture',
  'publickey-credentials-create',
  'publickey-credentials-get',
  'run-ad-auction',
  'screen-wake-lock',
  'serial',
  'shared-storage',
  'storage-access',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking',
] as const;
export type PermissionFeature = (typeof PERMISSION_FEATURES)[number];

export interface HeaderOptions {
  /** Features this app needs, allowed for its own origin only, e.g. ['screen-wake-lock']. */
  allowFeatures?: readonly PermissionFeature[] | undefined;
  /**
   * The app runs WebAssembly (`webAssembly: true` in apps.json): its CSP adds
   * 'wasm-unsafe-eval', which lets the browser compile WebAssembly files from
   * the site's own origin. It doesn't allow eval() of JavaScript (docs/adr/0011).
   *
   * It may also run WebAssembly on several processor cores ("threads"), which
   * start as workers from a plain URL. So its CSP also allows the Trusted Types
   * policy named "default": allowThreadScripts() in @shkriuss/ui/worker
   * creates it inside a worker, for exact URLs only (docs/adr/0012).
   */
  webAssembly?: boolean | undefined;
}

/**
 * Trusted Types policy names our own code creates (see @shkriuss/ui
 * service-worker.ts and worker.ts).
 */
export const TRUSTED_TYPES_POLICIES = ['shkriuss-sw', 'shkriuss-worker'];
/** For WebAssembly threads: only in apps with `webAssembly: true`. */
export const THREADS_POLICY = 'default';

export function contentSecurityPolicy(options: Pick<HeaderOptions, 'webAssembly'> = {}): string {
  const directives: Record<string, string> = {
    'default-src': "'none'",
    'script-src': options.webAssembly ? "'self' 'wasm-unsafe-eval'" : "'self'",
    'style-src': "'self'",
    'img-src': "'self' data: blob:",
    'font-src': "'self'",
    'connect-src': "'self'",
    'manifest-src': "'self'",
    'worker-src': "'self'",
    'base-uri': "'none'",
    // No form is ever sent the browser's own way: each page's script handles
    // its forms, and dialogs close without a request. Until that script runs,
    // pressing Enter in a form would put what was typed in the address, sent
    // to the server and kept in the browser's history (audit 4 C-1).
    'form-action': "'none'",
    'frame-ancestors': "'none'",
    'require-trusted-types-for': "'script'",
    'trusted-types': [
      ...TRUSTED_TYPES_POLICIES,
      ...(options.webAssembly ? [THREADS_POLICY] : []),
    ].join(' '),
  };
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ');
}

export function permissionsPolicy(options: HeaderOptions = {}): string {
  const allowed = new Set(options.allowFeatures ?? []);
  return PERMISSION_FEATURES.map((feature) =>
    allowed.has(feature) ? `${feature}=(self)` : `${feature}=()`,
  ).join(', ');
}

/** Headers sent with every response. */
export function securityHeaders(options: HeaderOptions = {}): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(options),
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': permissionsPolicy(options),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  };
}

/**
 * How browsers may keep hashed build files (/_astro/*): the same as pages,
 * asking the server each time. The year-long "immutable" header they had
 * reached a "not found" answer for a missing one too (audit 5 Z-1), and
 * kept a worker script's old security headers in the browser's cache after
 * a headers-only change (audit 5 C-1).
 */
export const BUILD_FILE_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/** The full text of the _headers file. */
export function headersFile(options: HeaderOptions = {}): string {
  const block = (pattern: string, headers: Record<string, string>): string =>
    [pattern, ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)].join('\n');

  return [
    '# Generated by @shkriuss/astro-config at build time. Do not edit by hand.',
    '# Source: packages/astro-config/src/headers.ts',
    '',
    block('/*', securityHeaders(options)),
    '',
    '# Build files have a content hash in their name, so they never change. Still,',
    '# a browser must ask again each time (a cheap 304 answer): Cloudflare gives',
    '# this header to its "not found" answer for a missing one too, which a',
    '# browser kept for the year the header used to say (audit 5 Z-1). The',
    '# service worker serves saved build files first, so nothing is slower.',
    block('/_astro/*', { 'Cache-Control': BUILD_FILE_CACHE_CONTROL }),
    '',
  ].join('\n');
}
