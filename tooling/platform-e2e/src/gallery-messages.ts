import { createFormat, defineMessages } from "@shkriuss/i18n";

/** The text of the components page. */
const messages = defineMessages((format) => ({
  title: () => "Components",
  buttons: () => "Buttons",
  save: () => "Save",
  cancel: () => "Cancel",
  remove: () => "Delete",
  unavailable: () => "Unavailable",
  presses: (count: number) =>
    format.plural(count, { one: "Pressed # time.", other: "Pressed # times." }),
  fields: () => "Fields",
  name: () => "Name",
  nameHelp: () => "As others should see it.",
  nameMissing: () => "Enter a name.",
  check: () => "Check",
  settings: () => "Settings",
  reminders: () => "Backup reminders",
  remindersOn: () => "Reminders are on.",
  remindersOff: () => "Reminders are off.",
  links: () => "Links",
  licenses: () => "Licenses",
  dialogs: () => "Dialogs",
  deleteAll: () => "Delete everything",
  confirmTitle: () => "Delete everything?",
  confirmText: () => "This cannot be undone.",
  deleted: () => "Everything was deleted.",
  kept: () => "Nothing was deleted.",
  files: () => "Files",
  pickFile: () => "Pick a file",
  noFile: () => "No file picked.",
  picked: (name: string, size: string) => `Picked ${name}, ${size}.`,
  notices: () => "Notices",
  update: () => "An update is available.",
  reload: () => "Reload",
  later: () => "Later",
}));

export const m = messages(createFormat());
