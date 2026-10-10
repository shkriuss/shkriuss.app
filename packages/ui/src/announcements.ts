/** What a screen last said to screen readers, of a change that the user made, and which saying it was. */
export interface Announcement {
  /** Counts the announcements: a new one each time, even when it says the same as the last. */
  readonly id: number;
  readonly text: string;
}

/**
 * The next announcement, after `last`: a new one even when it says the same, so that the screen
 * renders it anew and screen readers read it again (WCAG 4.1.3), as when two items with the same
 * text are deleted in turn.
 */
export function announce(last: Announcement | undefined, text: string): Announcement {
  return { id: (last?.id ?? 0) + 1, text };
}
