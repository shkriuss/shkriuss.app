/**
 * What every app with data loads on demand, after its first page (ADR 0018): the settings that
 * every app has, and the backup dialog, with the code that makes and restores backups. They are
 * one module, so that they load as one chunk: a chunk that loads later may import only the entry
 * script statically, as Safari requires (ADR 0010).
 */
export { BackupDialog } from "./BackupDialog.tsx";
export { SettingsScreen } from "./SettingsScreen.tsx";
