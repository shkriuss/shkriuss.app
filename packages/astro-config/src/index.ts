/**
 * Shared Astro configuration for the hub and every app.
 *
 * Each site's astro.config.ts is just:
 *
 *   import { defineAppConfig } from '@shkriuss/astro-config';
 *   export default defineAppConfig({ slug: 'tally' });
 *
 * Everything else (security headers, icons, offline support, build settings
 * that keep the strict Content Security Policy working) is decided here once.
 */
import type { AstroIntegration, AstroUserConfig } from 'astro';
import { getSite } from '@shkriuss/registry';
import type { PermissionFeature } from './headers.ts';
import { shkriussIntegration } from './integration.ts';

export interface AppConfigOptions {
  /** The site's slug from packages/registry/apps.json ("hub" for the hub). */
  slug: string;
  /** Browser features this app needs (all are blocked by default). */
  allowFeatures?: PermissionFeature[];
  /** Offline support via a service worker (default true). */
  pwa?: boolean;
  /** Extra Astro integrations, e.g. a UI framework if an app ever needs one. */
  integrations?: AstroIntegration[];
}

export function defineAppConfig(options: AppConfigOptions): AstroUserConfig {
  const site = getSite(options.slug);

  return {
    site: site.origin,
    // Pages are built as folder/index.html and linked as /folder/.
    trailingSlash: 'always',
    build: {
      format: 'directory',
      // Our CSP only allows styles and scripts from files, never inline.
      inlineStylesheets: 'never',
    },
    vite: {
      build: {
        // Never inline small scripts or assets into the HTML (CSP again).
        assetsInlineLimit: 0,
      },
      // Web workers are built as their own files (modules), started with
      // startWorker() from @shkriuss/ui/worker.
      worker: { format: 'es' },
    },
    devToolbar: { enabled: false },
    integrations: [
      shkriussIntegration({
        site,
        pwa: options.pwa ?? true,
        allowFeatures: options.allowFeatures,
        webAssembly: site.webAssembly,
      }),
      ...(options.integrations ?? []),
    ],
  };
}

export { contentSecurityPolicy, securityHeaders, headersFile } from './headers.ts';
export type { PermissionFeature } from './headers.ts';
