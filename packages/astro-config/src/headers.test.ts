/**
 * The exact security headers every site gets (docs/adr/0004). The browser
 * tests check that the sites send what headers.ts writes; this checks what
 * it writes, so a weaker header can't pass by changing both (audit J-3).
 * Change these only on purpose, with the ADR.
 */
import { describe, expect, it } from 'vitest';
import { headersFile, securityHeaders } from './headers.ts';
import { defineAppConfig } from './index.ts';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  'trusted-types shkriuss-sw shkriuss-worker',
].join('; ');

/** Every feature off, but the ones given (for the site's own origin only). */
const permissions = (allowed: string[] = []) =>
  [
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
  ]
    .map((feature) => `${feature}=${allowed.includes(feature) ? '(self)' : '()'}`)
    .join(', ');

const OTHERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

describe('the security headers', () => {
  it('are exactly these for an app', () => {
    expect(securityHeaders()).toEqual({
      'Content-Security-Policy': CSP,
      'Permissions-Policy': permissions(),
      ...OTHERS,
    });
  });

  it('let the hub, and only the hub, use passkeys', () => {
    const passkeys = ['publickey-credentials-create', 'publickey-credentials-get'] as const;
    expect(securityHeaders({ allowFeatures: passkeys })).toEqual({
      'Content-Security-Policy': CSP,
      'Permissions-Policy': permissions([...passkeys]),
      ...OTHERS,
    });
    expect(() => defineAppConfig({ slug: 'hub', allowFeatures: [...passkeys] })).not.toThrow();
    expect(() =>
      defineAppConfig({ slug: 'tally', allowFeatures: ['publickey-credentials-get'] }),
    ).toThrow(/Only the hub may use passkeys/);
    expect(() =>
      defineAppConfig({ slug: 'notes', allowFeatures: ['publickey-credentials-create'] }),
    ).toThrow(/Only the hub may use passkeys/);
  });

  it('never let a browser keep a build file, or a “not found” for one, without asking again (audit 5 Z-1)', () => {
    // Cloudflare gives the /_astro/* header to its "not found" answer for a
    // missing build file too: with a year-long "immutable" header, a browser
    // kept that failure for a year.
    const file = headersFile();
    expect(file).toContain('/_astro/*\n  Cache-Control: public, max-age=0, must-revalidate\n');
    const buildFiles = file.slice(file.indexOf('/_astro/*'));
    expect(buildFiles).not.toContain('immutable');
    expect(buildFiles).not.toMatch(/max-age=[1-9]/);
  });

  it('allow WebAssembly, and the policy for its threads, only for an app that runs it', () => {
    expect(securityHeaders({ webAssembly: true })).toEqual({
      'Content-Security-Policy': CSP.replace(
        "script-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
      ).replace(
        'trusted-types shkriuss-sw shkriuss-worker',
        'trusted-types shkriuss-sw shkriuss-worker default',
      ),
      'Permissions-Policy': permissions(),
      ...OTHERS,
    });
  });
});
