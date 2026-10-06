import { FileTrigger } from "react-aria-components";
import { Button, type ButtonProps } from "./Button.tsx";

export interface FileButtonProps extends Omit<ButtonProps, "onPress"> {
  /** Called with the file that the user picked; not called if they picked none. */
  readonly onSelect: (file: File) => void;
}

/**
 * A button that lets the user pick a file, through the browser's own file picker. Any type of
 * file can be picked: what a file is, the app tells from its content, never from its name or
 * type (backup format §5.2).
 */
export function FileButton({ onSelect, children, ...props }: FileButtonProps) {
  return (
    <FileTrigger
      onSelect={(files) => {
        const file = files?.item(0) ?? null;
        if (file !== null) {
          onSelect(file);
        }
      }}
    >
      <Button {...props}>{children}</Button>
    </FileTrigger>
  );
}
