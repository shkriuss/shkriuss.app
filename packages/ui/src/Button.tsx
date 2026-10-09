import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";

export interface ButtonProps extends Omit<AriaButtonProps, "className" | "style"> {
  /** The main action, another action, or one that deletes or cannot be undone. */
  readonly variant?: "primary" | "secondary" | "danger";
}

// A filled button has a border too, transparent: Windows' contrast themes, which drop
// backgrounds (forced colors), draw it, so that the button still looks like one.
const VARIANTS = {
  primary: "border border-transparent bg-accent text-accent-ink",
  secondary: "border border-line-strong bg-canvas text-ink",
  danger: "border border-transparent bg-danger text-danger-ink",
} as const;

/**
 * A button, at least 44 by 44 pixels so that it is easy to tap (WCAG 2.5.8). It responds to the
 * pointer, the keyboard and assistive technologies alike, through React Aria.
 */
export function Button({ variant = "secondary", ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={`inline-flex min-h-11 min-w-11 cursor-default items-center justify-center gap-2 rounded-lg px-4 font-medium data-disabled:opacity-50 data-pressed:brightness-90 ${VARIANTS[variant]}`}
    />
  );
}
