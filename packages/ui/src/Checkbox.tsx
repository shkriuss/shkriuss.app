import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
} from "react-aria-components";

export interface CheckboxProps extends Omit<AriaCheckboxProps, "className" | "style" | "children"> {
  /** The label. */
  readonly children: string;
}

/**
 * A checkbox, with its label, which ticks something off or back, as an item of a list. It is at
 * least 44 pixels high, so that it is easy to tap (WCAG 2.5.8), and its label takes the pointer
 * as well.
 */
export function Checkbox({ children, ...props }: CheckboxProps) {
  return (
    <AriaCheckbox
      {...props}
      className="group inline-flex min-h-11 cursor-default items-center gap-3 text-ink data-disabled:opacity-50"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-canvas group-data-focus-visible:outline-2 group-data-focus-visible:outline-offset-2 group-data-focus-visible:outline-focus group-data-selected:border-accent group-data-selected:bg-accent">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          className="hidden size-5 fill-accent-ink group-data-selected:block"
        >
          <path d="M3.58 13.42 9.5 19.34 20.42 8.42 18.58 6.58 9.5 15.66 5.42 11.58Z" />
        </svg>
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </AriaCheckbox>
  );
}
