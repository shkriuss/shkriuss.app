import { type ReactNode, use, useEffect } from "react";
import { FrameContext } from "./frame.ts";
import { m } from "./messages.ts";

export interface ScreenProps {
  /** What the screen is, as its heading and in the page's title. */
  readonly title: string;
  /** The screen's content, under its heading. */
  readonly children?: ReactNode;
}

/**
 * A screen of the app: its heading, and the page's title, which names the screen and the app,
 * as "Settings – Notes" (WCAG 2.4.2). When the user comes to the screen from another, the frame
 * gives the focus to its heading, which screen readers then read (WCAG 2.4.3).
 */
export function Screen({ title, children }: ScreenProps) {
  const { name } = use(FrameContext);
  useEffect(() => {
    document.title = m.pageTitle(title, name);
  }, [title, name]);
  return (
    <div className="flex flex-col gap-6">
      <h1 tabIndex={-1} className="text-2xl font-semibold wrap-anywhere">
        {title}
      </h1>
      {children}
    </div>
  );
}
