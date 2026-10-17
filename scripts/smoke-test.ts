/**
 * After a production deploy, checks every live site: it answers, serves HTML
 * and sends our security headers. Apps with notifications while closed must
 * also answer /api/push/key with their public key, and the hub its account
 * service (/api/account/ping). Retries for a few minutes because a brand
 * new subdomain can take a moment to get its DNS record and certificate.
 *
 *   node scripts/smoke-test.ts
 */
import { apps, getSite, HUB_SLUG } from '../packages/registry/src/index.ts';
import { contentSecurityPolicy } from '../packages/astro-config/src/headers.ts';

const ATTEMPTS = 10;
const WAIT_MS = 30_000;
const expectedCsp = contentSecurityPolicy();

const pushOrigins = new Set(
  apps.filter((app) => app.pushNotifications).map((app) => getSite(app.slug).origin),
);

async function check(origin: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${origin}/`, { redirect: 'manual' });
    if (response.status !== 200) return `status ${response.status}`;
    if (!response.headers.get('content-type')?.includes('text/html')) return 'not HTML';
    if (response.headers.get('content-security-policy') !== expectedCsp) {
      return 'missing or unexpected Content-Security-Policy header';
    }
    if (!response.headers.get('strict-transport-security')) return 'missing HSTS header';
    if (origin === getSite(HUB_SLUG).origin) {
      const ping = await fetch(`${origin}/api/account/ping`);
      if (!ping.ok) return 'account service not answering';
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

const origins = [HUB_SLUG, ...apps.map((app) => app.slug)].map((slug) => getSite(slug).origin);
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
console.log('\nAll sites are live with their security headers.');
