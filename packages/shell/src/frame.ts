import { createContext } from "react";

/** What the frame does for the components in it, such as its banners and screens. */
export interface Frame {
  /** The app's name, for the page's title; `undefined` outside a frame. */
  readonly name: string | undefined;
  /**
   * Gives the focus to the screen, as when a banner goes away with the button that had it, so
   * that the focus is not lost (WCAG 2.4.3).
   */
  readonly focusScreen: () => void;
}

/** What components get outside a frame: no name, and nothing happens. */
export const NO_FRAME: Frame = { name: undefined, focusScreen: () => undefined };

export const FrameContext = createContext<Frame>(NO_FRAME);
