import type { ReactNode } from "react";

export interface BannerProps {
  /** The message: text, or elements that go in a line of text. */
  readonly children: ReactNode;
  /** Buttons for what the user can do about it. */
  readonly actions?: ReactNode;
}

/**
 * A notice that does not interrupt, such as that an update is available. It is an `<output>`,
 * whose role is `status`, so screen readers read it when it appears, without moving the focus.
 */
export function Banner({ children, actions }: BannerProps) {
  return (
    <output className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4 text-ink">
      <span className="grow">{children}</span>
      {actions === undefined ? null : <span className="flex flex-wrap gap-2">{actions}</span>}
    </output>
  );
}
