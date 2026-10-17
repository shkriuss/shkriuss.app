// Calendar's Worker. Requests to /api/push/* (notifications while Calendar is
// closed) run this code; everything else is the built site in dist/, served
// as before. See packages/push and docs/adr/0009-push-notifications.md.
export { default, PushDevice, PushKeys } from '@shkriuss/push/worker';
