// Budget's Worker. Requests to /api/push/* (the monthly reminder while Budget
// is closed) and /api/sync/* (syncing between devices with the optional
// account) run this code; everything else is the built site in dist/, served
// as before. See packages/push, packages/sync, docs/adr/0009 and docs/adr/0010.
import { handlePush, type PushEnv } from '@shkriuss/push/worker';
import { createWorker } from '@shkriuss/server';
import { handleSync, type SyncEnv } from '@shkriuss/sync/worker';

export { PushDevice, PushKeys } from '@shkriuss/push/worker';
export { SyncCopy } from '@shkriuss/sync/worker';

export default createWorker<PushEnv & SyncEnv>({
  '/api/push': handlePush,
  '/api/sync': handleSync,
});
