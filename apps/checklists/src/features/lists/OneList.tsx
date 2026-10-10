import { Screen, ScreenLink, useObserved } from "@shkriuss/shell";
import { Button, Checkbox, Dialog } from "@shkriuss/ui";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { m } from "../../messages.ts";
import { type AppDatabase, NAME_LENGTH, TEXT_LENGTH } from "../../schema.ts";
import { writeFailure } from "./failures.ts";
import { AddForm, TextForm } from "./forms.tsx";
import { type ItemRecord, type ListContent, itemsOf, neighbor, readList } from "./lists.ts";

export interface OneListProps {
  readonly db: AppDatabase;
  readonly listId: string;
  /** The list as its route read it, which the screen shows until it observes the list. */
  readonly loaded: ListContent;
}

/** The dialog that is open, if any. */
type Open =
  | { readonly dialog: "none" }
  | { readonly dialog: "item"; readonly item: ItemRecord }
  | { readonly dialog: "rename"; readonly name: string }
  | { readonly dialog: "delete"; readonly items: number };

const CLOSED: Open = { dialog: "none" };

/**
 * Where the focus goes once the screen shows a change that the user made: to an item's
 * checkbox, or to the "New item" field (WCAG 2.4.3). The element that had the focus went with
 * the items, or moved with them to the other section.
 */
interface FocusAfter {
  /** The items that the change ticked off, ticked back or deleted. */
  readonly items: readonly string[];
  /** What the change made of them. */
  readonly now: "done" | "toDo" | "deleted";
  /** The item whose checkbox takes the focus; the field if none. */
  readonly to: string | undefined;
}

/** An item's text, or what stands for it if it has none: the app writes none, but a backup could. */
function textOf(item: ItemRecord): string {
  return item.values.text === "" ? m.noText() : item.values.text;
}

function Actions({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Failure({ message }: { readonly message: string | undefined }) {
  return message === undefined ? null : (
    <p role="alert" className="text-danger">
      {message}
    </p>
  );
}

/**
 * A list's screen (docs/specs/apps/checklists.md §1): its items to do, then those done, each
 * with a checkbox that ticks it off or back and a button that edits it; a field that adds an
 * item; and buttons that clear the done items, rename the list and delete it. It follows every
 * change, in this window or another, and shows when the list is not there, or not anymore.
 */
export function OneList({ db, listId, loaded }: OneListProps) {
  const observed = useObserved(
    useMemo(() => db.observe(async (reader) => readList(reader, listId)), [db, listId]),
  );
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string>();
  // What the last change did, for screen readers: the focus moved on from the items it moved.
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<Open>(CLOSED);
  const [dialogFailure, setDialogFailure] = useState<string>();
  const [focusAfter, setFocusAfter] = useState<FocusAfter>();
  // The last of those that took place: each takes place once.
  const focused = useRef<FocusAfter>(undefined);
  // What the screen showed when the user deleted the list, which it shows until the lists do.
  const [leaving, setLeaving] = useState<ListContent>();
  const field = useRef<HTMLInputElement>(null);
  const sections = useRef<HTMLDivElement>(null);
  const dialogContent = useRef<HTMLDivElement>(null);
  const toDoHeading = useId();
  const doneHeading = useId();

  const content = leaving ?? (observed.state === "ready" ? observed.value : loaded);
  const { list } = content;
  const { toDo, done } = itemsOf(listId, content.items);

  useEffect(() => {
    if (focusAfter === undefined || focused.current === focusAfter) {
      return;
    }
    const { items, now, to } = focusAfter;
    const shown = items.every((id) => {
      const item = content.items.find((candidate) => candidate.id === id);
      return now === "deleted" ? item === undefined : item?.values.done === (now === "done");
    });
    if (shown) {
      const target =
        to === undefined
          ? null
          : sections.current?.querySelector<HTMLElement>(`[data-item="${to}"] input`);
      (target ?? field.current)?.focus();
      focused.current = focusAfter;
    }
  }, [focusAfter, content]);

  useEffect(() => {
    // Once the dialog is open, its field takes the focus, so that the user types at once; or
    // else its question does, so that screen readers read it, and Enter deletes nothing.
    if (open.dialog !== "none") {
      const dialog = dialogContent.current;
      (dialog?.querySelector("input") ?? dialog)?.focus();
    }
  }, [open.dialog]);

  function close(): void {
    setOpen(CLOSED);
    setDialogFailure(undefined);
  }

  async function addItem(text: string): Promise<boolean> {
    try {
      await db.change(async (change) => {
        // Not on a list that another window deleted: the screen shows that it is gone.
        if ((await change.get("lists", listId)) !== undefined) {
          await change.create("items", { list: listId, text });
        }
      });
    } catch (error) {
      setFailure(writeFailure(error, m.addItemFailed()));
      return false;
    }
    setFailure(undefined);
    return true;
  }

  async function tick(item: ItemRecord, isDone: boolean): Promise<void> {
    // The section that the item leaves: the next item there takes the focus, as the user goes
    // down the list; the item itself does in its new section, if it was the last.
    const section = isDone ? toDo : done;
    try {
      await db.change(async (change) => change.update("items", item.id, { done: isDone }));
    } catch (error) {
      setFailure(writeFailure(error, m.changeFailed()));
      return;
    }
    setFailure(undefined);
    setStatus(isDone ? m.movedToDone(textOf(item)) : m.movedToToDo(textOf(item)));
    setFocusAfter({
      items: [item.id],
      now: isDone ? "done" : "toDo",
      to: neighbor(section, item.id) ?? item.id,
    });
  }

  async function saveItem(item: ItemRecord, value: string): Promise<void> {
    // A text that the user left as it was is not written: it would win a merge over a change
    // made earlier on another device (spec §3).
    if (value !== item.values.text) {
      try {
        await db.change(async (change) => change.update("items", item.id, { text: value }));
      } catch (error) {
        setDialogFailure(writeFailure(error, m.changeFailed()));
        return;
      }
    }
    close();
  }

  async function deleteItem(item: ItemRecord): Promise<void> {
    try {
      await db.change(async (change) => change.delete("items", item.id));
    } catch (error) {
      setDialogFailure(writeFailure(error, m.changeFailed()));
      return;
    }
    close();
    setStatus(m.itemDeleted(textOf(item)));
    setFocusAfter({
      items: [item.id],
      now: "deleted",
      to: neighbor(toDo, item.id) ?? neighbor(done, item.id),
    });
  }

  async function clearDone(): Promise<void> {
    let cleared: string[];
    try {
      cleared = await db.change(async (change) => {
        const items = await change.list("items");
        const ids = items
          .filter(({ values }) => values.list === listId && values.done)
          .map(({ id }) => id);
        for (const id of ids) {
          await change.delete("items", id);
        }
        return ids;
      });
    } catch (error) {
      setFailure(writeFailure(error, m.changeFailed()));
      return;
    }
    setFailure(undefined);
    setStatus(m.doneCleared(cleared.length));
    setFocusAfter({ items: cleared, now: "deleted", to: undefined });
  }

  async function renameList(from: string, to: string): Promise<void> {
    // As for an item's text: a name left as it was is not written.
    if (to !== from) {
      try {
        await db.change(async (change) => change.update("lists", listId, { name: to }));
      } catch (error) {
        setDialogFailure(writeFailure(error, m.changeFailed()));
        return;
      }
    }
    close();
  }

  async function deleteList(): Promise<void> {
    setLeaving(content);
    try {
      // The list and every item on it, in one change (spec §2).
      await db.change(async (change) => {
        for (const item of await change.list("items")) {
          if (item.values.list === listId) {
            await change.delete("items", item.id);
          }
        }
        await change.delete("lists", listId);
      });
    } catch (error) {
      setLeaving(undefined);
      setDialogFailure(writeFailure(error, m.changeFailed()));
      return;
    }
    close();
    // In place of the list, which Back would only show as gone.
    await navigate({ to: "/", replace: true });
  }

  if (list === undefined) {
    return (
      <Screen title={m.listNotFoundTitle()}>
        <p>{m.listNotFoundText()}</p>
        <p>
          <ScreenLink to="/">{m.toLists()}</ScreenLink>
        </p>
      </Screen>
    );
  }

  const name = list.values.name === "" ? m.noName() : list.values.name;

  function row(item: ItemRecord) {
    const label = textOf(item);
    return (
      <li
        key={item.id}
        data-item={item.id}
        className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-1"
      >
        <Checkbox
          isSelected={item.values.done}
          onChange={(isDone) => {
            void tick(item, isDone);
          }}
        >
          {label}
        </Checkbox>
        <Button
          aria-label={m.editItem(label)}
          onPress={() => {
            setOpen({ dialog: "item", item });
          }}
        >
          {m.edit()}
        </Button>
      </li>
    );
  }

  let items;
  if (observed.state === "failed") {
    items = <p>{m.itemsFailed()}</p>;
  } else if (toDo.length === 0 && done.length === 0) {
    items = <p>{m.itemsEmpty()}</p>;
  } else {
    items = (
      <div ref={sections} className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 id={toDoHeading} className="text-xl font-semibold">
            {m.toDo()}
          </h2>
          {toDo.length === 0 ? (
            <p>{m.nothingToDo()}</p>
          ) : (
            <ul aria-labelledby={toDoHeading} className="flex flex-col gap-2">
              {toDo.map(row)}
            </ul>
          )}
        </section>
        {done.length === 0 ? null : (
          <section className="flex flex-col gap-3">
            <h2 id={doneHeading} className="text-xl font-semibold">
              {m.done()}
            </h2>
            <ul aria-labelledby={doneHeading} className="flex flex-col gap-2">
              {done.map(row)}
            </ul>
            <div>
              <Button
                onPress={() => {
                  void clearDone();
                }}
              >
                {m.clearDone()}
              </Button>
            </div>
          </section>
        )}
      </div>
    );
  }

  let title = "";
  let body: ReactNode = null;
  switch (open.dialog) {
    case "none":
      break;
    case "item": {
      const { item } = open;
      title = m.editItem(textOf(item));
      body = (
        <TextForm
          label={m.text()}
          initial={item.values.text}
          maxLength={TEXT_LENGTH}
          missing={m.textMissing()}
          failure={dialogFailure}
          onSave={(value) => {
            void saveItem(item, value);
          }}
        >
          <Button
            variant="danger"
            onPress={() => {
              void deleteItem(item);
            }}
          >
            {m.deleteItem()}
          </Button>
          <Button onPress={close}>{m.cancel()}</Button>
        </TextForm>
      );
      break;
    }
    case "rename": {
      const from = open.name;
      title = m.renameListTitle(name);
      body = (
        <TextForm
          label={m.name()}
          initial={from}
          maxLength={NAME_LENGTH}
          missing={m.newListMissing()}
          failure={dialogFailure}
          onSave={(value) => {
            void renameList(from, value);
          }}
        >
          <Button onPress={close}>{m.cancel()}</Button>
        </TextForm>
      );
      break;
    }
    case "delete":
      title = m.deleteListTitle(name);
      body = (
        <>
          <p>{m.deleteListText(open.items)}</p>
          <Failure message={dialogFailure} />
          <Actions>
            <Button
              variant="danger"
              onPress={() => {
                void deleteList();
              }}
            >
              {m.deleteList()}
            </Button>
            <Button onPress={close}>{m.cancel()}</Button>
          </Actions>
        </>
      );
      break;
  }

  return (
    <Screen title={name} pageTitle={m.list()}>
      <AddForm
        label={m.newItem()}
        missing={m.newItemMissing()}
        maxLength={TEXT_LENGTH}
        onAdd={addItem}
        inputRef={field}
      />
      <Failure message={failure} />
      {items}
      {/* An <output>, whose role is status: screen readers read it when it changes. */}
      <output className="sr-only">{status}</output>
      <Actions>
        <Button
          onPress={() => {
            setOpen({ dialog: "rename", name: list.values.name });
          }}
        >
          {m.renameList()}
        </Button>
        <Button
          variant="danger"
          onPress={() => {
            setOpen({ dialog: "delete", items: toDo.length + done.length });
          }}
        >
          {m.deleteList()}
        </Button>
      </Actions>
      <Dialog isOpen={open.dialog !== "none"} onClose={close} title={title}>
        <div ref={dialogContent} tabIndex={-1} className="flex flex-col gap-4 outline-none">
          {body}
        </div>
      </Dialog>
    </Screen>
  );
}
