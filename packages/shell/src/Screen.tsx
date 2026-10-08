import { type ReactNode, use, useEffect } from "react";
import { FrameContext } from "./frame.ts";
import { m } from "./messages.ts";

export interface ScreenProps {
  /** What the screen is, as its heading and in the page's title. */
  readonly title: string;
  /**
   * What the page's title calls the screen instead, when `title` is something that the user
   * named, such as a list: browsers keep page titles in their history, which they may sync
   * (threat model T11).
   */
  readonly pageTitle?: string;
  /** The screen's content, under its heading. */
  readonly children?: ReactNode;
}

/**
 * A screen of the app: its heading, and the page's title, which names the screen and the app,
 * as "Settings – Notes" (WCAG 2.4.2). When the user comes to the screen from another, the frame
 * gives the focus to its heading, which screen readers then read (WCAG 2.4.3).
 */
export function Screen({ title, pageTitle = title, children }: ScreenProps) {
  const { name } = use(FrameContext);
  useEffect(() => {
    document.title = m.pageTitle(pageTitle, name);
  }, [pageTitle, name]);
  return (
    <div className="flex flex-col gap-6">
      <h1 tabIndex={-1} className="text-2xl font-semibold wrap-anywhere">
        {title}
      </h1>
      {children}
    </div>
  );
}
