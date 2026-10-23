/**
 * An app's sync server in memory, for tests: the real Worker code and
 * Durable Objects (@shkriuss/server/testing), with each copy's storage in a
 * Map. `copies.runAlarms()` wakes the copies whose alarm is due.
 */
import { createWorker, type DurableObjectNamespace } from '@shkriuss/server';
import { memoryNamespace } from '@shkriuss/server/testing';
import worker, { SyncCopy, syncHandler, type SyncEnv } from './worker.ts';

/** An app's Worker with files on (worker.ts's default has them off). */
export const withFiles = createWorker<SyncEnv>({ '/api/sync': syncHandler({ files: true }) });

export function memorySync() {
  const env: SyncEnv = {
    ASSETS: { fetch: async () => new Response('page') },
    SYNC_COPIES: null as unknown as DurableObjectNamespace,
  };
  const copies = memoryNamespace((state) => new SyncCopy(state, env));
  env.SYNC_COPIES = copies.namespace;
  return {
    env,
    copies,
    fetch: (request: Request) => worker.fetch(request, env),
    fetchWithFiles: (request: Request) => withFiles.fetch(request, env),
  };
}
