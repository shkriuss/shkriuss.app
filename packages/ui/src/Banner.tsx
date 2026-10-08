import type { ReactNode } from "react";

export interface BannerProps {
  /** The message: text, or elements that go in a line of text. */
  readonly children: ReactNode;
  /** Buttons for what the user can do about it. */
  readonly actions?: ReactNode;
}

/**
 * A notice that does not interrupt, such as that an update is available. Screen readers read it
 * when it appears in a status region that was there before it, as the frame of `@shkriuss/shell`
 * has: a banner is no live region of its own, since one that appears with its text already in
 * it often goes unread. It is a line of text, as that region, an `<output>`, may hold.
 */
export function Banner({ children, actions }: BannerProps) {
  return (
    <span className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4 text-ink">
      <span className="grow">{children}</span>
      {actions === undefined ? null : <span className="flex flex-wrap gap-2">{actions}</span>}
    </span>
  );
}
