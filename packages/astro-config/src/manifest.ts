import type { SiteInfo } from '@shkriuss/registry';
import { backgroundColors } from '@shkriuss/ui/colors';

/** The web app manifest: makes a site installable to the home screen. */
export function webManifest(site: SiteInfo): Record<string, unknown> {
  return {
    id: '/',
    name: site.name,
    short_name: site.name.length <= 12 ? site.name : site.name.slice(0, 12),
    description: site.description,
    lang: 'en',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: backgroundColors.light,
    theme_color: backgroundColors.light,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
