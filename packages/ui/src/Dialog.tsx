import { type ReactNode, useEffect, useId, useRef } from "react";

export interface DialogProps {
  /** Whether it is open. While it is, the rest of the page can be neither used nor scrolled. */
  readonly isOpen: boolean;
  /** Called when it closes: when the user presses Escape, or after `isOpen` became false. */
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
}

/**
 * A modal dialog, on the browser's own `<dialog>`: it takes the focus, closes with Escape, and
 * gives the focus back when it closes. React Aria's modal would add a stylesheet to the page on
 * iOS, which the Content-Security-Policy refuses.
 */
export function Dialog({ isOpen, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-line bg-canvas p-6 text-ink backdrop:bg-[rgb(0_0_0/0.5)]"
    >
      <h2 id={titleId} className="mb-4 text-xl font-semibold">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
