import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from "react-aria-components";

export interface SwitchProps extends Omit<AriaSwitchProps, "className" | "style" | "children"> {
  /** The label. */
  readonly children: string;
}

/** A switch that turns a setting on or off at once, with its label. */
export function Switch({ children, ...props }: SwitchProps) {
  return (
    <AriaSwitch
      {...props}
      className="group inline-flex min-h-11 cursor-default items-center gap-3 text-ink data-disabled:opacity-50"
    >
      <span className="flex h-7 w-12 shrink-0 items-center rounded-full border border-line-strong bg-surface p-0.5 group-data-focus-visible:outline-2 group-data-focus-visible:outline-offset-2 group-data-focus-visible:outline-focus group-data-selected:border-accent group-data-selected:bg-accent">
        <span className="size-5 rounded-full bg-line-strong transition-transform group-data-selected:translate-x-5 group-data-selected:bg-accent-ink" />
      </span>
      {children}
    </AriaSwitch>
  );
}
