import type { Announcement } from "./announcements.ts";

export interface StatusProps {
  /** What the screen last said, from `announce()`; nothing yet when undefined. */
  readonly announcement: Announcement | undefined;
  /** Classes for the `<output>`, such as `sr-only` for one that only screen readers get. */
  readonly className?: string;
}

/**
 * An `<output>`, whose role is status: screen readers read what is added to it, without
 * interrupting. Each announcement is an element of its own, added anew even when it says the
 * same as the last, which the same text in place would not be (WCAG 4.1.3): deleting two items
 * with the same text, or copying twice, is read twice.
 */
export function Status({ announcement, className }: StatusProps) {
  return (
    <output className={className}>
      {announcement === undefined ? null : <span key={announcement.id}>{announcement.text}</span>}
    </output>
  );
}
