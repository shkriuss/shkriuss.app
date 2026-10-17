// Tally's Worker. Requests to /api/sync/* (syncing between devices with the
// optional account) run this code; everything else is the built site in
// dist/, served as before. See packages/sync and docs/adr/0010-account-and-sync.md.
export { default, SyncCopy } from '@shkriuss/sync/worker';
