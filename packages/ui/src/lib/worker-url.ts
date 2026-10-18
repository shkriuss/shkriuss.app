/**
 * Which URLs startWorker() (scripts/worker.ts) may start a worker from: only
 * files the build made for this site, under /_astro/.
 */
export function isBuiltWorkerUrl(input: string, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    return false;
  }
  return (
    url.origin === origin &&
    url.pathname.startsWith('/_astro/') &&
    url.pathname.endsWith('.js') &&
    url.search === '' &&
    url.hash === ''
  );
}
