/**
 * After a production deploy, checks every live site: it answers, serves
 * exactly the home page that was deployed (apps/<slug>/dist/index.html, so a
 * Cloudflare feature can't quietly rewrite pages), and sends our security
 * headers. Apps with notifications while closed must
 * also answer /api/push/key with their public key, and the hub its account
 * service (/api/account/ping), and apps with sync /api/sync/hub, and apps
 * with an online library /api/library/* (asking for a token). Retries for a
 * few minutes because a brand new subdomain can take a moment to get its DNS
 * record and certificate.
 *
 *   node scripts/smoke-test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apps, getSite, HUB_SLUG } from '../packages/registry/src/index.ts';
import { contentSecurityPolicy } from '../packages/astro-config/src/headers.ts';
import { livePageProblem } from './lib/live-page.ts';
import { repoRoot } from './lib/sites.ts';

const ATTEMPTS = 10;
const WAIT_MS = 30_000;

const pushOrigins = new Set(
  apps.filter((app) => app.pushNotifications).map((app) => getSite(app.slug).origin),
);
const syncOrigins = new Set(apps.filter((app) => app.sync).map((app) => getSite(app.slug).origin));
const libraryOrigins = new Set(
  apps.filter((app) => app.library).map((app) => getSite(app.slug).origin),
);
const slugs = [HUB_SLUG, ...apps.map((app) => app.slug)];
/** Each site's home page, as deployed. */
const deployedPages = new Map(
  slugs.map((slug) => {
    const path = join(repoRoot, 'apps', slug, 'dist', 'index.html');
    if (!existsSync(path)) {
      console.error(`No build to compare with: ${path}. Run pnpm build first.`);
      process.exit(1);
    }
    return [getSite(slug).origin, readFileSync(path, 'utf8')];
  }),
);
/** Each site's expected CSP (apps that run WebAssembly allow just that). */
const expectedCsp = new Map(
  slugs.map((slug) => {
    const site = getSite(slug);
    return [site.origin, contentSecurityPolicy({ webAssembly: site.webAssembly })];
  }),
);

async function check(origin: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${origin}/`, { redirect: 'manual' });
    if (response.status !== 200) return `status ${response.status}`;
    if (!response.headers.get('content-type')?.includes('text/html')) return 'not HTML';
    if (response.headers.get('content-security-policy') !== expectedCsp.get(origin)) {
      return 'missing or unexpected Content-Security-Policy header';
    }
    if (!response.headers.get('strict-transport-security')) return 'missing HSTS header';
    const pageProblem = livePageProblem(await response.text(), deployedPages.get(origin) ?? '');
    if (pageProblem) return pageProblem;
    if (origin === getSite(HUB_SLUG).origin) {
      const ping = await fetch(`${origin}/api/account/ping`);
      if (!ping.ok) return 'account service not answering';
    }
    if (syncOrigins.has(origin)) {
      const hub = await fetch(`${origin}/api/sync/hub`);
      const body = (await hub.json().catch(() => ({}))) as { origin?: unknown };
      if (!hub.ok || body.origin !== getSite(HUB_SLUG).origin) return 'sync service not answering';
    }
    if (libraryOrigins.has(origin)) {
      // Without a token it must refuse, as JSON: the library's code is running.
      const changes = await fetch(`${origin}/api/library/changes`);
      const body = (await changes.json().catch(() => ({}))) as { error?: unknown };
      if (changes.status !== 401 || typeof body.error !== 'string') {
        return 'online library not answering';
      }
    }
    if (pushOrigins.has(origin)) {
      const key = await fetch(`${origin}/api/push/key`);
      const body = (await key.json().catch(() => ({}))) as { publicKey?: unknown };
      if (!key.ok || typeof body.publicKey !== 'string')
        return 'notification service not answering';
    }
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

const origins = slugs.map((slug) => getSite(slug).origin);
let pending = origins;

for (let attempt = 1; attempt <= ATTEMPTS && pending.length > 0; attempt += 1) {
  const results = await Promise.all(
    pending.map(async (origin) => [origin, await check(origin)] as const),
  );
  for (const [origin, problem] of results) {
    console.log(problem ? `… ${origin}: ${problem}` : `✓ ${origin}`);
  }
  pending = results.filter(([, problem]) => problem).map(([origin]) => origin);
  if (pending.length > 0 && attempt < ATTEMPTS) {
    console.log(`Waiting ${WAIT_MS / 1000}s before trying again (${attempt}/${ATTEMPTS})…`);
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  }
}

if (pending.length > 0) {
  console.error(`\nThese sites are not working: ${pending.join(', ')}`);
  process.exit(1);
}
console.log('\nAll sites are live, as deployed, with their security headers.');
