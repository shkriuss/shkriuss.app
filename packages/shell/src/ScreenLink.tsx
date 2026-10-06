import { createLink } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, Ref } from "react";

interface AnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly ref?: Ref<HTMLAnchorElement>;
  /** What the router sets on a link that leads nowhere. Anchors have no such attribute. */
  readonly disabled?: boolean;
}

/** A plain anchor in the base styles of a link, with a rounded focus outline. */
function Anchor({ disabled: _disabled, className, children, ...props }: AnchorProps) {
  return (
    <a {...props} className={className === undefined ? "rounded-sm" : `rounded-sm ${className}`}>
      {children}
    </a>
  );
}

/**
 * A link to another screen of the app, which the router opens without loading the page again,
 * as TanStack Router's `Link` does: its `to` is checked against the app's routes, and the link to
 * the screen that shows has `aria-current="page"`. It is a plain anchor, so the browser handles
 * the keyboard and opens it in a new tab when the user asks.
 */
export const ScreenLink = createLink(Anchor);
