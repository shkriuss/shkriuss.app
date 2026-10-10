import type { Ref } from "react";
import {
  TextArea as AriaTextArea,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  FieldError,
  Label,
  Text,
} from "react-aria-components";

export interface TextAreaProps extends Omit<
  AriaTextFieldProps,
  "className" | "style" | "children"
> {
  readonly label: string;
  /** Help that stays below the field. */
  readonly description?: string;
  /** What is wrong, shown while the field is invalid. */
  readonly errorMessage?: string;
  /** How many lines it shows before it scrolls; the user can make it taller. */
  readonly rows?: number;
  /** The text area itself, as to move the focus to it or to select part of its text. */
  readonly textAreaRef?: Ref<HTMLTextAreaElement>;
}

/**
 * A labeled field for text of several lines, with an optional description and error message.
 * It leaves the browser's spell checker as it is: an app that checks the text itself passes
 * `spellCheck="false"`, as some browsers send the text to a server to check it.
 */
export function TextArea({
  label,
  description,
  errorMessage,
  rows = 6,
  textAreaRef,
  ...props
}: TextAreaProps) {
  return (
    <AriaTextField {...props} className="flex flex-col gap-1">
      <Label className="font-medium text-ink">{label}</Label>
      <AriaTextArea
        ref={textAreaRef}
        rows={rows}
        className="min-h-11 resize-y rounded-lg border border-line-strong bg-canvas px-3 py-2 text-ink data-invalid:border-danger"
      />
      {description === undefined ? null : (
        <Text slot="description" className="text-sm text-ink-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-sm text-danger">{errorMessage}</FieldError>
    </AriaTextField>
  );
}
