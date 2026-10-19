// Shelf's Worker. Requests to /api/sync/* (syncing between devices through
// the optional shkriuss account) run this code; everything else is the built
// site in dist/. See packages/sync and docs/adr/0010-account-and-sync.md.
export { default, SyncCopy } from '@shkriuss/sync/worker';
