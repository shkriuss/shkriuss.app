import { Button, TextField } from "@shkriuss/ui";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { m } from "../../messages.ts";

/*
 * Names and texts are never blank (spec §1). A field says so when the user submits it blank,
 * and its error goes as soon as the user edits it: the layout moves while the user types, never
 * while they press. The browser's own checks would take the error away with the focus, when
 * the pointer goes down on a button, and move the button from under it.
 */

export interface AddFormProps {
  readonly label: string;
  /** What the field says when the user adds nothing. */
  readonly missing: string;
  readonly maxLength: number;
  /** Adds the value, without the spaces around it; true if it was added: the field empties. */
  readonly onAdd: (value: string) => Promise<boolean>;
  /** The field's input, as to move the focus to it. */
  readonly inputRef?: RefObject<HTMLInputElement | null>;
}

/** A field and its "Add" button, which adds what the field says. */
export function AddForm({ label, missing, maxLength, onAdd, inputRef }: AddFormProps) {
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const [value, setValue] = useState("");
  const [blank, setBlank] = useState(false);

  async function add(): Promise<void> {
    const trimmed = value.trim();
    if (trimmed === "") {
      setBlank(true);
      input.current?.focus();
      return;
    }
    if (await onAdd(trimmed)) {
      setValue("");
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <TextField
        label={label}
        value={value}
        onChange={(next) => {
          setValue(next);
          setBlank(false);
        }}
        isRequired
        validationBehavior="aria"
        isInvalid={blank}
        errorMessage={missing}
        maxLength={maxLength}
        inputRef={input}
      />
      <Button type="submit" variant="primary">
        {m.add()}
      </Button>
    </form>
  );
}

export interface TextFormProps {
  readonly label: string;
  /** The value that the field starts with. */
  readonly initial: string;
  /** What the field says when the user saves nothing. */
  readonly missing: string;
  readonly maxLength: number;
  /** Why the last save failed, if it did. */
  readonly failure: string | undefined;
  /** Saves the value, without the spaces around it. */
  readonly onSave: (value: string) => void;
  /** The form's buttons besides "Save". */
  readonly children: ReactNode;
}

/** The form of a dialog that renames something: its field and "Save". */
export function TextForm({
  label,
  initial,
  missing,
  maxLength,
  failure,
  onSave,
  children,
}: TextFormProps) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [blank, setBlank] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed === "") {
          setBlank(true);
          input.current?.focus();
          return;
        }
        onSave(trimmed);
      }}
    >
      <TextField
        label={label}
        value={value}
        onChange={(next) => {
          setValue(next);
          setBlank(false);
        }}
        isRequired
        validationBehavior="aria"
        isInvalid={blank}
        errorMessage={missing}
        maxLength={maxLength}
        inputRef={input}
      />
      {failure === undefined ? null : (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          {m.save()}
        </Button>
        {children}
      </div>
    </form>
  );
}
