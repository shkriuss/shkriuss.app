/**
 * After a production deploy, checks every live site: it answers, serves
 * exactly the home page that was deployed (apps/<slug>/dist/index.html, so a
 * Cloudflare feature can't quietly rewrite pages), and sends our security
 * headers and its /.well-known/security.txt and /robots.txt as deployed (a
 * site without a robots.txt got one written by Cloudflare, audit 5 I-1).
 * Apps with notifications while closed must
 * also answer /api/push/key with their public key, and the hub its account
 * service (/api/account/ping), and apps with sync /api/sync/hub, and apps
 * with an online library /api/library/* (asking for a token). Apps with
 * files downloaded only on request (like Grammar's Deep check) must serve
 * each of their manifests as deployed: the saved build leaves those files
 * out, and only the deploy puts them back (audit 3 J-7). Retries for a few
 * minutes because a brand new subdomain can take a moment to get its DNS
 * record and certificate.
 *
 *   node scripts/smoke-test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
/**
 * Each app's on-demand manifests, as deployed ("on-demand/deep-check/manifest.json"
 * and its text), for the apps CI puts on-demand files back into (their
 * "on-demand-into-dist" script). One of those whose build has none was
 * deployed without them.
 */
const onDemand = new Map(
  apps
    .filter((app) => {
      const manifest = readFileSync(join(repoRoot, 'apps', app.slug, 'package.json'), 'utf8');
      const { scripts = {} } = JSON.parse(manifest) as { scripts?: Record<string, string> };
      return 'on-demand-into-dist' in scripts;
    })
    .map((app) => {
      const dir = join(repoRoot, 'apps', app.slug, 'dist', 'on-demand');
      const manifests = existsSync(dir)
        ? readdirSync(dir).filter((name) => existsSync(join(dir, name, 'manifest.json')))
        : [];
      if (manifests.length === 0) {
        console.error(`${app.slug} was built without its on-demand files (${dir}).`);
        process.exit(1);
      }
      return [
        getSite(app.slug).origin,
        manifests.map((name) => {
          const path = `on-demand/${name}/manifest.json`;
          return [path, readFileSync(join(dir, name, 'manifest.json'), 'utf8')] as const;
        }),
      ];
    }),
);
const SECURITY_TXT = '.well-known/security.txt';
const ROBOTS_TXT = 'robots.txt';
/** Each site's text file at `path`, as deployed (security.txt's "Expires" date is set at build time). */
const deployedText = (path: string) =>
  new Map(
    slugs.map((slug) => {
      const file = join(repoRoot, 'apps', slug, 'dist', path);
      if (!existsSync(file)) {
        console.error(`No build to compare with: ${file}. Run pnpm build first.`);
        process.exit(1);
      }
      return [getSite(slug).origin, readFileSync(file, 'utf8')];
    }),
  );
const deployedSecurityTxt = deployedText(SECURITY_TXT);
const deployedRobotsTxt = deployedText(ROBOTS_TXT);
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
    // In a folder whose name starts with a dot, which is easy to leave out.
    const securityTxt = await fetch(`${origin}/${SECURITY_TXT}`);
    if (!securityTxt.ok || (await securityTxt.text()) !== deployedSecurityTxt.get(origin)) {
      return `/${SECURITY_TXT} isn't the one deployed`;
    }
    // Cloudflare can serve a robots.txt of its own, or add its text to ours
    // (its "managed robots.txt", in the dashboard under the zone's bot
    // settings): then this says so, and that setting needs turning off.
    const robotsTxt = await fetch(`${origin}/${ROBOTS_TXT}`);
    if (!robotsTxt.ok || (await robotsTxt.text()) !== deployedRobotsTxt.get(origin)) {
      return `/${ROBOTS_TXT} isn't the one deployed (is Cloudflare's managed robots.txt on?)`;
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
    for (const [path, deployed] of onDemand.get(origin) ?? []) {
      const manifest = await fetch(`${origin}/${path}`);
      if (!manifest.ok || (await manifest.text()) !== deployed)
        return `/${path} isn't the one deployed`;
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
