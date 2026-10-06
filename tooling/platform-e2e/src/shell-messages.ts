import { createFormat, defineMessages } from "@shkriuss/i18n";

/** The text of the shell's page. */
const messages = defineMessages(() => ({
  app: () => "Notes",
  description: () => "Notes that stay on this device, to test the shell.",
  notes: () => "Notes",
  archive: () => "Archive",
  archiveEmpty: () => "Nothing is archived.",
  loading: () => "Loading the notes…",
  empty: () => "No notes yet.",
  failed: () => "The notes could not be read.",
  breakScreen: () => "Break this screen",
}));

export const m = messages(createFormat());
