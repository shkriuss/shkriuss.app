import { createFormat, defineMessages } from "@shkriuss/i18n";

/** The hub's text (ADR 0012). */
const messages = defineMessages(() => ({
  title: () => "shkriuss.app",
  lead: () => "Small, private web apps that work offline.",
  comingSoon: () => "The first apps are on their way.",
  expect: () => "What to expect",
  local: () => "Your data stays on your device. There are no accounts and no tracking.",
  offline: () => "Every app works offline once it has loaded.",
  backups: () => "Encrypted backups move your data between your devices.",
  source: () => "The source code is public:",
  sourceLink: () => "github.com/shkriuss/shkriuss.app",
  licenses: () => "It includes software of others, under their own licenses:",
  licensesLink: () => "licenses.txt",
}));

/** The hub's text, with this device's formats. */
export const m = messages(createFormat());
