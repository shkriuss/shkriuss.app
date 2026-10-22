// Photos' Worker. Requests to /api/sync/* (syncing through the optional
// shkriuss account) and /api/library/* (the online photo library, in R2) run
// this code; everything else is the built site in dist/. See packages/sync,
// packages/library and docs/adr/0016-online-photo-library.md.
import { handleLibrary, type LibraryEnv } from '@shkriuss/library/worker';
import { createWorker } from '@shkriuss/server';
import { syncHandler, type SyncEnv } from '@shkriuss/sync/worker';

export { Library } from '@shkriuss/library/worker';
export { SyncCopy } from '@shkriuss/sync/worker';

export default createWorker<SyncEnv & LibraryEnv>({
  '/api/sync': syncHandler(),
  '/api/library': handleLibrary,
});
