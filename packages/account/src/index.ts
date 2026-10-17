/**
 * The shkriuss account, browser side (docs/adr/0010). Used by the hub's
 * Account page; the server side is ./worker.ts.
 */
export { AccountError, type AccountErrorCode } from './errors.ts';
export { currentAccount, forgetAccount, saveAccount, type Account } from './device.ts';
export {
  claimLink,
  createLink,
  linkState,
  parseLinkFragment,
  type DeviceLink,
  type LinkInFragment,
  type LinkState,
} from './link.ts';
export {
  addPasskey,
  passkeySupport,
  removePasskey,
  signInWithPasskey,
  type PasskeySupport,
} from './passkey.ts';
export {
  accountCodeOf,
  generateSecret,
  parseRecoveryKey,
  recoveryKeyOf,
  sameSecret,
  type RecoveryKeyResult,
} from './secret.ts';
export { LINK_LIFETIME_MS } from './validate.ts';
