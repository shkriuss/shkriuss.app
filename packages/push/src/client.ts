/**
 * Notifications while an app is closed: the browser side (docs/adr/0009).
 *
 *   enablePush()        ask permission, subscribe this device
 *   syncPush(notices)   upload the app's scheduled notifications, encrypted
 *   pushHolds(notices)  whether the server has them as they are now
 *   sendTestPush()      one notification right now
 *   disablePush()       forget this device on the server and unsubscribe
 *   finishPushDelete()  try again to forget it, if the server couldn't be reached
 *
 * The switch and turning it on or off (./device.ts) load with the page.
 * Uploading, with the encryption and the schedule's rules (./upload.ts),
 * loads the first time it's needed, so pages start with less to load
 * (Calendar is near its start-up budget).
 */
import { load } from './device.ts';
import type * as Upload from './upload.ts';

export {
  disablePush,
  enablePush,
  finishPushDelete,
  isPushDeletePending,
  isPushEnabled,
  PushError,
  pushSupport,
  timeLimit,
  type PushErrorCode,
  type PushSupport,
} from './device.ts';
export type { Notice } from './upload.ts';

const upload = (): Promise<typeof Upload> => import('./upload.ts');

export const syncPush: typeof Upload.syncPush = async (...args) =>
  (await upload()).syncPush(...args);

// Nothing to load to know that nothing was uploaded (push is off, say).
export const pushHolds: typeof Upload.pushHolds = async (...args) =>
  load()?.synced ? (await upload()).pushHolds(...args) : false;

export const sendTestPush: typeof Upload.sendTestPush = async (...args) =>
  (await upload()).sendTestPush(...args);
