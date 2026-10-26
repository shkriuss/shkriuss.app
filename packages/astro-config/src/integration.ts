/**
 * The shkriuss Astro integration. Added to every site by defineAppConfig().
 *
 * During the build it provides `virtual:shkriuss/site` (this site's registry
 * entry) to pages. When the build finishes it writes into dist/:
 *
 * - _headers: the shared security headers;
 * - .well-known/security.txt: where to report a security problem;
 * - manifest.webmanifest, favicon.svg and PNG icons, for installing the app;
 * - sw.js: the offline service worker (it lists every other file, except
 *   on-demand ones, so it is written last).
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { hubOrigin, type SiteInfo } from '@shkriuss/registry';
import { appIconSvg, ICON_VARIANTS, renderPng, type IconVariant } from './app-icons.ts';
import { contentSecurityPolicy, headersFile, type HeaderOptions } from './headers.ts';
import { SECURITY_TXT, securityTxt } from './security-txt.ts';
import { webManifest } from './manifest.ts';
import { ON_DEMAND_DIR, precacheUrls, serviceWorkerSource } from './service-worker.ts';
import { workerVersion } from './worker-version.ts';

const VIRTUAL_ID = 'virtual:shkriuss/site';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;

/** PNG icons every site gets: file name → pixel size and style. */
const PNG_ICONS: Record<string, { size: number; variant: IconVariant }> = {
  'icon-192.png': { size: 192, variant: ICON_VARIANTS.any },
  'icon-512.png': { size: 512, variant: ICON_VARIANTS.any },
  'icon-maskable-512.png': { size: 512, variant: ICON_VARIANTS.maskable },
  'apple-touch-icon.png': { size: 180, variant: ICON_VARIANTS.apple },
};

export interface IntegrationOptions extends HeaderOptions {
  site: SiteInfo;
  /** Generate the offline service worker (default true). */
  pwa: boolean;
}

/** All file paths under `dir`, relative to it, using "/" separators. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** A short hash of every file's path and content. */
async function hashFiles(dir: string, files: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(join(dir, file)));
  }
  return hash.digest('hex').slice(0, 12);
}

export function shkriussIntegration(options: IntegrationOptions): AstroIntegration {
  const { site } = options;

  return {
    name: '@shkriuss/astro-config',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'shkriuss:site',
                resolveId(id: string) {
                  return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined;
                },
                load(id: string) {
                  if (id !== RESOLVED_VIRTUAL_ID) return undefined;
                  return [
                    `export const site = ${JSON.stringify(site)};`,
                    `export const hubOrigin = ${JSON.stringify(hubOrigin)};`,
                  ].join('\n');
                },
              },
            ],
          },
        });
      },

      'astro:build:done': async ({ dir, logger }) => {
        const distDir = fileURLToPath(dir);
        const write = (file: string, content: string | Uint8Array) =>
          writeFile(join(distDir, file), content);

        await write('_headers', headersFile(options));
        await mkdir(join(distDir, dirname(SECURITY_TXT)), { recursive: true });
        await write(SECURITY_TXT, securityTxt(site.origin));
        await write('manifest.webmanifest', `${JSON.stringify(webManifest(site), null, 2)}\n`);
        await write('favicon.svg', appIconSvg(site, ICON_VARIANTS.favicon));
        for (const [file, { size, variant }] of Object.entries(PNG_ICONS)) {
          await write(file, await renderPng(appIconSvg(site, variant), size));
        }
        logger.info('Wrote _headers, security.txt, manifest.webmanifest and icons.');

        if (options.pwa) {
          const files = (await listFiles(distDir)).filter(
            // security.txt isn't needed offline, and its date would change the version.
            (file) =>
              file !== '_headers' && file !== SECURITY_TXT && !file.startsWith(ON_DEMAND_DIR),
          );
          const urls = precacheUrls(files);
          const csp = contentSecurityPolicy(options);
          // The version covers the saved files, the worker's own code and
          // the headers, so changing any one gives visitors a fresh saved copy.
          const version = workerVersion({
            files: await hashFiles(distDir, files),
            worker: serviceWorkerSource({ files: urls, version: '', csp }),
            headers: headersFile(options),
          });
          await write('sw.js', serviceWorkerSource({ files: urls, version, csp }));
          logger.info(`Wrote sw.js (offline support, version ${version}).`);
        }
      },
    },
  };
}
