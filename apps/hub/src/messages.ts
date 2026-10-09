import type { BrowserFeature } from "@shkriuss/edge";
import { createFormat, defineMessages } from "@shkriuss/i18n";

/** The browser features that an app may ask for, as its privacy label names them. */
const FEATURES: Readonly<Record<BrowserFeature, string>> = {
  accelerometer: "motion sensors",
  autoplay: "autoplay",
  camera: "camera",
  "captured-surface-control": "control of a shared screen",
  "clipboard-read": "reading the clipboard",
  "clipboard-write": "writing to the clipboard",
  "compute-pressure": "processor load",
  "cross-origin-isolated": "cross-origin isolation",
  "deferred-fetch": "requests after leaving",
  "deferred-fetch-minimal": "small requests after leaving",
  "digital-credentials-get": "digital credentials",
  "display-capture": "screen capture",
  "encrypted-media": "protected media",
  fullscreen: "full screen",
  gamepad: "game controllers",
  geolocation: "location",
  gyroscope: "rotation sensors",
  hid: "HID devices",
  "identity-credentials-get": "federated sign-in",
  "idle-detection": "idle detection",
  "keyboard-map": "keyboard layout",
  "language-detector": "language detection",
  "local-fonts": "installed fonts",
  "local-network-access": "the local network",
  magnetometer: "compass",
  microphone: "microphone",
  midi: "MIDI devices",
  "on-device-speech-recognition": "speech recognition",
  "otp-credentials": "one-time codes",
  payment: "payments",
  "picture-in-picture": "picture-in-picture",
  "publickey-credentials-create": "creating passkeys",
  "publickey-credentials-get": "passkeys",
  "screen-wake-lock": "keeping the screen on",
  serial: "serial ports",
  "storage-access": "storage access",
  summarizer: "summarizing text",
  "sync-xhr": "synchronous requests",
  translator: "translating text",
  usb: "USB devices",
  "window-management": "window management",
  "xr-spatial-tracking": "virtual reality",
};

/** When the privacy policy last changed, which its page says (docs/specs/hub.md §3). */
const POLICY_CHANGED = new Date(2026, 9, 9);

/** The hub's text (ADR 0012). */
const messages = defineMessages((format) => ({
  // The frame.
  title: () => "shkriuss.app",
  install: () => "Install",
  privacy: () => "Privacy",
  security: () => "Security",
  freeSoftware: () =>
    "The apps and this site are free software, under the GNU Affero General Public License, version 3.",
  sourceCode: () => "Source code",
  licenses: () => "Licenses",
  // The apps.
  lead: () => "Small, private web apps that work offline.",
  intro: () =>
    "Your data stays on your device: there are no accounts, and nothing tracks you. Each app works offline once it has loaded, and encrypted backups move your data between your devices.",
  apps: () => "Apps",
  noApps: () => "The first apps are on their way.",
  dataCollected: () => "Data collected",
  noData: () => "None",
  leavesDevice: () => "Leaves this device",
  onlyBackups: () => "Only the backups that you save",
  nothing: () => "Nothing",
  permissions: () => "Browser permissions",
  features: (features: readonly BrowserFeature[]) =>
    features.length === 0
      ? "None"
      : format.list(
          features.map((feature) => FEATURES[feature]),
          "and",
        ),
  // Installing.
  installTitle: () => "Install an app",
  installIntro: () =>
    "Each app installs on its own, from its own address. Installed, it opens like any other app, offline too. Open the app, then:",
  iphone: () => "On an iPhone or iPad",
  iphoneOpen: () => "Open the app in Safari.",
  iphoneShare: () => "Tap Share, the square with an arrow.",
  iphoneAdd: () => "Tap Add to Home Screen, then Add.",
  iphoneData: () =>
    "The installed app keeps its own data, apart from Safari's. To take along what you entered in Safari, back it up there, in the app's settings, and restore the backup in the installed app.",
  android: () => "On Android",
  androidOpen: () => "Open the app in Chrome.",
  androidInstall: () =>
    "Open the app's settings and tap Install. Or open Chrome's menu and tap Install app.",
  computer: () => "On a computer",
  computerChrome: () =>
    "In Chrome or Edge: click the install icon at the end of the address bar, or open the app's settings and click Install.",
  computerSafari: () => "In Safari on a Mac: choose File, then Add to Dock.",
  computerOther: () => "In other browsers, use the app in a tab: it works offline there too.",
  // Privacy.
  privacyChanged: () => `Last changed on ${format.date(POLICY_CHANGED)}.`,
  yourData: () => "Your data stays on your device",
  yourDataText: () =>
    "The apps keep what you enter in your browser's storage, on your device. They have no accounts and set no cookies. They send none of your data anywhere, and load nothing from other sites: no analytics, no telemetry, no tracking.",
  host: () => "What our host sees",
  hostText: () =>
    "Cloudflare serves the apps and this site. As the host of any website does, it sees each request: your IP address, your browser's user agent, the address requested and the time. The sites turn on no logging or analytics of their own.",
  hostPolicy: () => "Cloudflare's privacy policy",
  backups: () => "Backups",
  backupsText: () =>
    "A backup is a file that you save, wherever you choose. It is encrypted by default, with a passphrase that the apps never store or send anywhere. Your browser may offer to save the passphrase, as it does passwords: if you let it, its password manager keeps it. A plain backup, which you can choose after a warning, is not encrypted: anyone who gets the file can read it.",
  changes: () => "Changes",
  changesText: () => "Every change to this policy is in the history of the source code.",
  changesLink: () => "The history of this page",
  // Security.
  protection: () => "How the apps are protected",
  integrity: () =>
    "Every script that a page loads has an integrity hash, and the browser refuses a script that does not match it.",
  policy: () =>
    "A strict Content Security Policy and Trusted Types keep injected code from running.",
  origins: () => "Each app has its own address, so no app can read another's data.",
  offlineCopy: () =>
    "An app keeps a copy of itself for offline use only if every file matches its published hash.",
  threatModel: () => "The threat model",
  threatModelText: () => "explains the rest.",
  check: () => "Check what a site serves",
  checkText: () =>
    "Every site lists the SHA-256 hash of each file that it serves, at /sha256sums.txt. GitHub signs where each file was built: from which commit, by which workflow. With GitHub's command-line tool, anyone can check a file that a site serves:",
  checkCommand: () =>
    "curl -sSL -o index.html https://shkriuss.app/\ngh attestation verify index.html --repo shkriuss/shkriuss.app",
  report: () => "Report a problem",
  reportText: () =>
    "Please report security problems privately, through GitHub. Every site also says how, at /.well-known/security.txt.",
  reportLink: () => "Report a vulnerability",
  policyLink: () => "Security policy",
  // Pages that are not there, or did not load.
  notFoundTitle: () => "Page not found",
  notFoundText: () => "This site has no page at this address.",
  toApps: () => "Go to the apps",
  errorTitle: () => "Something went wrong",
  errorText: () => "This page could not be loaded. Reload it to try again.",
  reload: () => "Reload",
}));

/** The hub's text, with this device's formats. */
export const m = messages(createFormat());
