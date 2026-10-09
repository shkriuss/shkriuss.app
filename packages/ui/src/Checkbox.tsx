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
      className="group inline-flex min-h-11 min-w-0 cursor-default items-center gap-3 text-ink data-disabled:opacity-50"
    >
      {/* Windows' contrast themes (forced colors) would drop the box's background, and leave
          the check mark in the colour of the page: the box takes their colours instead. */}
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-canvas group-data-focus-visible:outline-2 group-data-focus-visible:outline-offset-2 group-data-focus-visible:outline-focus group-data-selected:border-accent group-data-selected:bg-accent forced-colors:border-[ButtonText] forced-colors:bg-[Canvas] forced-colors:forced-color-adjust-none group-data-selected:forced-colors:border-[Highlight] group-data-selected:forced-colors:bg-[Highlight]">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          className="hidden size-5 fill-accent-ink group-data-selected:block forced-colors:fill-[HighlightText]"
        >
          <path d="M3.58 13.42 9.5 19.34 20.42 8.42 18.58 6.58 9.5 15.66 5.42 11.58Z" />
        </svg>
      </span>
      {/* A long word, such as a link, breaks rather than widen the page (WCAG 1.4.10). */}
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </AriaCheckbox>
  );
}
