# Checklists

- **Status:** accepted, 2026-10-06 (Phase 1.5)
- **App id:** `checklists`, at `https://checklists.shkriuss.app`. Permanent (`CLAUDE.md`, product rule 3).
- **Builds on:** the [data model](../data-model.md), the [backup format](../backup-format.md) and the [app template](../../../tooling/app-template/README.md).
- **Implemented by:** `apps/checklists` (Phase 1.5)

Lists to tick off, such as shopping, packing or to-dos, kept on the device, offline. Backups move them between devices and merge them. It is the pilot app of Phase 1: it proves the platform on the iPhone, the Pixel and the Pixel Tablet ([roadmap](../../roadmap.md)).

## 1. Screens

| Screen   | Address       | What it shows and does                                                                                                          |
| -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Lists    | `/`           | Every list, by name, with how many of its items are done, as "3 of 8 done". A field adds a list. Each list leads to its screen. |
| A list   | `/lists/<id>` | The list's items: those to do, in the order they were added, then those done, under "Done". A field adds an item.               |
| Settings | `/settings`   | The settings that every app has: installing, storage, backups, About.                                                           |

**On a list's screen:**

- **Items:** each has a checkbox, labeled with its text, that ticks it off or back. It can be renamed, and deleted.
- **Clear done items** deletes every item that is done.
- **The list** can be renamed, and deleted with its items, after the user confirms it in a dialog: it cannot be undone.
- **A list that does not exist,** whether deleted here, on another device, or never there, shows that it does not exist, with a link to the lists.
- **The page's title** says only "List", not the list's name, which is the screen's heading: browsers keep page titles in their history, which they may sync.

Names and texts must not be empty or blank; the fields refuse them. The screens follow every change, in this window or another.

**The focus follows the user,** as in the template:

- An item that is ticked off or back moves to the other section, and the focus goes to the next item of the section it left, so that the user can go down the list, or to the one before it if there is no next; to the item itself if it was the only one. Screen readers hear where it went.
- After an item is deleted, the focus goes to the next item of its section, or to the one before it; to the field once its section has none.
- After **Clear done items**, the focus goes to the field.
- A new list opens, with the focus on its name.

## 2. Data

Schema version 1. Every field has the default of its type ([data model](../data-model.md) §2.3).

| Store   | Field  | Type                     | Meaning                  |
| ------- | ------ | ------------------------ | ------------------------ |
| `lists` | `name` | string, at most 100      | The list's name          |
| `items` | `list` | reference to `lists`     | The list the item is on  |
| `items` | `text` | string, at most 200      | What the item says       |
| `items` | `done` | boolean, default `false` | Whether it is ticked off |

- **Order:** lists by name, as people read them ("List 2" before "List 10"), items by id, which is the order they were added in (UUIDv7). There is no field for order: reordering is not in version 1.
- **Writes:** a change writes only what the user changed. Saving a name or a text unchanged writes nothing, as it would otherwise win a merge over a change made earlier on another device.
- **Deleting a list** deletes it and every item on it, in one change.
- **No settings record:** the app has no settings of its own in version 1.

## 3. Merging

Backups merge field by field ([data model](../data-model.md) §5). For checklists, that means:

| On one device        | On the other       | After both are merged                                                                                      |
| -------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Ticks an item        | Renames it         | The item, renamed and ticked                                                                               |
| Ticks an item        | Unticks it later   | Unticked: the later change wins                                                                            |
| Adds items to a list | Adds others        | All of them                                                                                                |
| Deletes an item      | Ticked it earlier  | Deleted                                                                                                    |
| Deletes an item      | Ticks it later     | Gone from the list: the tick comes back alone, without the item's text and list, which the deletion erased |
| Deletes a list       | Adds an item to it | The list stays deleted; the item is kept but shown nowhere                                                 |
| Deletes a list       | Renames it later   | The list, renamed, without the items that the deletion took                                                |

Items whose list is deleted or missing, or that have no list, are kept, as the data model requires, but no screen shows them.

## 4. What else

- **Export formats:** none but backups in version 1. Sharing a list as text may follow.
- **Privacy label:** no data collected. Everything stays on the device; only the backups that the user saves leave it.
- **Browser permissions:** none.
- **Icon:** a check mark, white on green (`#15803d`).

## 5. Tests

- **Screens and flows,** end to end in every browser: lists and items added, ticked, renamed and deleted; a list deleted after the user confirms; clearing done items; a list that does not exist; changes in another window; offline after the first visit, a list and its changes kept; no accessibility violation in either theme.
- **Merging, through real backups:** each row of section 3, with two devices in a test, one backup made on each and restored on the other.
- **Every backup version restores** ([backup format](../backup-format.md) §8): fixture backups of schema version 1, plain and encrypted, made by the app and never changed.
- **On real devices,** for the phase's exit criteria: installed on the iPhone, the Pixel and the Pixel Tablet; offline; updated; and an encrypted backup moving lists between the iPhone and the Pixel, merged as above.

## 6. Not in version 1

Reordering, quantities and notes on items, several people on one list, reminders, a trash or undo, search.
