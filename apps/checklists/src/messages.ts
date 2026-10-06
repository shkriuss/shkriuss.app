import { createFormat, defineMessages } from "@shkriuss/i18n";

/**
 * The app's text (ADR 0012): its name and what it does, for its frame, its manifest and its
 * page's title, and the text of its screens.
 */
export const messages = defineMessages((format) => ({
  appName: () => "Checklists",
  // The name under the icon on a home screen: at most 12 characters.
  appShortName: () => "Checklists",
  appDescription: () =>
    "Lists to tick off, for shopping, packing or to-dos, that stay on this device.",
  // The lists.
  lists: () => "Lists",
  newList: () => "New list",
  newListMissing: () => "Enter the list's name.",
  add: () => "Add",
  addListFailed: () => "The list could not be added. Reload the app to try again.",
  listsLoading: () => "Reading the lists…",
  listsFailed: () => "The lists could not be read. Reload the app to try again.",
  listsEmpty: () => "No lists yet.",
  progress: (done: number, total: number) =>
    total === 0 ? "No items" : `${format.number(done)} of ${format.number(total)} done`,
  noName: () => "(no name)",
  // A list.
  listLoading: () => "Reading the list…",
  newItem: () => "New item",
  newItemMissing: () => "Enter the item.",
  addItemFailed: () => "The item could not be added. Reload the app to try again.",
  itemsFailed: () => "The list could not be read. Reload the app to try again.",
  itemsEmpty: () => "No items yet.",
  toDo: () => "To do",
  nothingToDo: () => "Nothing left to do.",
  done: () => "Done",
  noText: () => "(no text)",
  movedToDone: (text: string) => `“${text}” moved to Done.`,
  movedToToDo: (text: string) => `“${text}” moved to To do.`,
  edit: () => "Edit",
  editItem: (text: string) => `Edit “${text}”`,
  text: () => "Text",
  textMissing: () => "Enter the item.",
  save: () => "Save",
  cancel: () => "Cancel",
  deleteItem: () => "Delete item",
  itemDeleted: (text: string) => `“${text}” deleted.`,
  clearDone: () => "Clear done items",
  doneCleared: (items: number) =>
    format.plural(items, { one: "# done item cleared.", other: "# done items cleared." }),
  renameList: () => "Rename list",
  renameListTitle: (name: string) => `Rename “${name}”`,
  name: () => "Name",
  deleteList: () => "Delete list",
  deleteListTitle: (name: string) => `Delete “${name}”?`,
  deleteListText: (items: number) =>
    items === 0
      ? "The list is deleted. This cannot be undone."
      : format.plural(items, {
          one: "The list and its # item are deleted. This cannot be undone.",
          other: "The list and its # items are deleted. This cannot be undone.",
        }),
  changeFailed: () => "The change could not be saved. Reload the app to try again.",
  listNotFoundTitle: () => "List not found",
  listNotFoundText: () =>
    "This list is not on this device: it was deleted, here or on another device, or never was.",
  toLists: () => "Go to the lists",
}));

export const m = messages(createFormat());
