// Repairs' Worker. Requests to /api/sync/* (syncing between devices through
// the optional shkriuss account, photos included) run this code; everything
// else is the built site in dist/. See packages/sync,
// docs/adr/0010-account-and-sync.md and docs/adr/0014-syncing-photos.md.
import { createWorker } from '@shkriuss/server';
import { syncHandler, type SyncEnv } from '@shkriuss/sync/worker';

export { SyncCopy } from '@shkriuss/sync/worker';

export default createWorker<SyncEnv>({ '/api/sync': syncHandler({ files: true }) });
