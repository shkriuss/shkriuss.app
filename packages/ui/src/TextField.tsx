import type { Ref } from "react";
import {
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  FieldError,
  Input,
  Label,
  Text,
} from "react-aria-components";

export interface TextFieldProps extends Omit<
  AriaTextFieldProps,
  "className" | "style" | "children"
> {
  readonly label: string;
  /** Help that stays below the field. */
  readonly description?: string;
  /** What is wrong, shown while the field is invalid. */
  readonly errorMessage?: string;
  /** The input itself, as to move the focus to it. */
  readonly inputRef?: Ref<HTMLInputElement>;
}

/** A labeled text field, with an optional description and error message tied to its input. */
export function TextField({
  label,
  description,
  errorMessage,
  inputRef,
  ...props
}: TextFieldProps) {
  return (
    <AriaTextField {...props} className="flex flex-col gap-1">
      <Label className="font-medium text-ink">{label}</Label>
      <Input
        ref={inputRef}
        className="min-h-11 rounded-lg border border-line-strong bg-canvas px-3 text-ink data-invalid:border-danger"
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
