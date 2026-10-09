import { ScreenLink, useObserved } from "@shkriuss/shell";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { m } from "../../messages.ts";
import { type AppDatabase, NAME_LENGTH } from "../../schema.ts";
import { writeFailure } from "./failures.ts";
import { AddForm } from "./forms.tsx";
import { byName, progressOf } from "./lists.ts";

export interface AllListsProps {
  readonly db: AppDatabase;
}

/**
 * Every list, by name, with how much of it is done, and a field that adds a list and opens it
 * (docs/specs/apps/checklists.md §1). It follows every change, in this window or another.
 */
export function AllLists({ db }: AllListsProps) {
  const overview = useObserved(
    useMemo(
      () =>
        db.observe(async (reader) => ({
          lists: await reader.list("lists"),
          items: await reader.list("items"),
        })),
      [db],
    ),
  );
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | undefined>(undefined);

  async function add(name: string): Promise<boolean> {
    let listId: string;
    try {
      listId = await db.change(async (change) => change.create("lists", { name }));
    } catch (error) {
      setFailure(writeFailure(error, m.addListFailed()));
      return false;
    }
    setFailure(undefined);
    await navigate({ to: "/lists/$listId", params: { listId } });
    return true;
  }

  let content;
  if (overview.state === "loading") {
    content = <p>{m.listsLoading()}</p>;
  } else if (overview.state === "failed") {
    content = <p>{m.listsFailed()}</p>;
  } else if (overview.value.lists.length === 0) {
    content = <p>{m.listsEmpty()}</p>;
  } else {
    const { lists, items } = overview.value;
    content = (
      <ul aria-label={m.lists()} className="flex flex-col gap-2">
        {byName(lists).map(({ id, values }) => {
          const { done, total } = progressOf(id, items);
          // The whole row leads to the list, and says how much of it is done.
          return (
            <li key={id} className="rounded-lg border border-line">
              <ScreenLink
                to="/lists/$listId"
                params={{ listId: id }}
                className="flex min-h-11 flex-col justify-center px-3 py-2 no-underline"
              >
                <span className="font-medium wrap-anywhere underline underline-offset-[0.15em]">
                  {values.name === "" ? m.noName() : values.name}
                </span>{" "}
                <span className="text-sm text-ink-muted">{m.progress(done, total)}</span>
              </ScreenLink>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AddForm
        label={m.newList()}
        missing={m.newListMissing()}
        maxLength={NAME_LENGTH}
        onAdd={add}
      />
      {failure === undefined ? null : (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      {content}
    </div>
  );
}
