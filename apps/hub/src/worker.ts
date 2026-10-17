// The hub's Worker. Requests to /api/account/* (the optional shkriuss account)
// run this code; everything else is the built site in dist/, served as
// before. See packages/account and docs/adr/0010-account-and-sync.md.
export { default, AccountLink, AccountPasskey } from '@shkriuss/account/worker';
