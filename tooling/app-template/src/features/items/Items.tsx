import { isStorageFull } from "@shkriuss/data";
import { useObserved } from "@shkriuss/shell";
import { Button, TextField } from "@shkriuss/ui";
import { useMemo, useRef, useState } from "react";
import { m } from "../../messages.ts";
import { type AppDatabase, ITEM_LENGTH } from "../../schema.ts";

export interface ItemsProps {
  readonly db: AppDatabase;
}

/**
 * The app's items: a field that adds one, and the list, which follows every change, in this
 * window or another. An example of a feature, which a new app replaces with its own.
 */
export function Items({ db }: ItemsProps) {
  const items = useObserved(
    useMemo(() => db.observe(async (reader) => reader.list("items")), [db]),
  );
  const [text, setText] = useState("");
  // The field says that it is empty when the user adds nothing, and not before; the error goes
  // as soon as the user types, so that nothing moves while they press "Add". The browser's own
  // checks would take it away with the focus, and the button from under the pointer.
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string>();
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  async function add(): Promise<void> {
    const value = text.trim();
    if (value === "") {
      setMissing(true);
      field.current?.focus();
      return;
    }
    try {
      await db.change(async (change) => change.create("items", { text: value }));
      setText("");
      setFailure(undefined);
    } catch (error) {
      setFailure(isStorageFull(error) ? m.storageFull() : m.addFailed());
    }
  }

  async function remove(id: string, next: string | undefined): Promise<void> {
    try {
      await db.change(async (change) => change.delete("items", id));
      setFailure(undefined);
    } catch (error) {
      setFailure(isStorageFull(error) ? m.storageFull() : m.deleteFailed());
      return;
    }
    // The focus was on the button that went with the item: it goes to the next item's, or the
    // field once the list is empty (WCAG 2.4.3).
    const button =
      next === undefined
        ? null
        : list.current?.querySelector<HTMLElement>(`[data-item="${next}"] button`);
    (button ?? field.current)?.focus();
  }

  let content;
  if (items.state === "loading") {
    content = <p>{m.itemsLoading()}</p>;
  } else if (items.state === "failed") {
    content = <p>{m.itemsFailed()}</p>;
  } else if (items.value.length === 0) {
    content = <p>{m.itemsEmpty()}</p>;
  } else {
    const all = items.value;
    content = (
      <ul ref={list} aria-label={m.items()} className="flex flex-col gap-2">
        {all.map(({ id, values }, index) => (
          <li
            key={id}
            data-item={id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
          >
            <span className="min-w-0 wrap-anywhere">{values.text}</span>
            <Button
              aria-label={m.deleteItem(values.text)}
              onPress={() => {
                void remove(id, (all[index + 1] ?? all[index - 1])?.id);
              }}
            >
              {m.delete()}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <TextField
          label={m.newItem()}
          value={text}
          onChange={(value) => {
            setText(value);
            setMissing(false);
          }}
          isRequired
          validationBehavior="aria"
          isInvalid={missing}
          maxLength={ITEM_LENGTH}
          errorMessage={m.newItemMissing()}
          inputRef={field}
        />
        <Button type="submit" variant="primary">
          {m.add()}
        </Button>
      </form>
      {failure === undefined ? null : (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      {content}
    </div>
  );
}
