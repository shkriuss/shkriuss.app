import { createFormat, defineMessages } from "@shkriuss/i18n";

/**
 * The app's text (ADR 0012): its name and what it does, for its frame, its manifest and its
 * page's title, and the text of its screens.
 */
export const messages = defineMessages(() => ({
  appName: () => "Template",
  // The name under the icon on a home screen: at most 12 characters.
  appShortName: () => "Template",
  appDescription: () => "A list that stays on this device: the app that every new app starts from.",
  items: () => "Items",
  newItem: () => "New item",
  newItemMissing: () => "Enter the item.",
  add: () => "Add",
  addFailed: () => "The item could not be added. Reload the app to try again.",
  itemsLoading: () => "Reading the items…",
  itemsFailed: () => "The items could not be read. Reload the app to try again.",
  itemsEmpty: () => "No items yet.",
  delete: () => "Delete",
  deleteItem: (text: string) => `Delete “${text}”`,
  deleteFailed: () => "The item could not be deleted. Reload the app to try again.",
}));

export const m = messages(createFormat());
