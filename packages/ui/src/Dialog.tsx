import { type ReactNode, useEffect, useId, useRef } from "react";

export interface DialogProps {
  /** Whether it is open. While it is, the rest of the page can be neither used nor scrolled. */
  readonly isOpen: boolean;
  /** Called when it closes: when the user presses Escape, or after `isOpen` became false. */
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  /**
   * Whether Escape closes it; true by default. While it is false, as while the work that the
   * dialog shows cannot stop, Escape does nothing, and if the browser closes the dialog all the
   * same, as it does after a second Escape, it opens again.
   */
  readonly isDismissable?: boolean;
}

/**
 * A modal dialog, on the browser's own `<dialog>`: it takes the focus, closes with Escape, and
 * gives the focus back when it closes. React Aria's modal would add a stylesheet to the page on
 * iOS, which the Content-Security-Policy refuses.
 */
export function Dialog({ isOpen, onClose, title, children, isDismissable = true }: DialogProps) {
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
      onCancel={(event) => {
        if (!isDismissable) {
          event.preventDefault();
        }
      }}
      onClose={() => {
        // The browser says that the dialog closed in a task of its own, after it did. A dialog
        // that is open by then opened again in between, as when the user reopens it at once:
        // that close is over, and must not close it again.
        if (ref.current?.open === true) {
          return;
        }
        if (isOpen && !isDismissable) {
          ref.current?.showModal();
          return;
        }
        onClose();
      }}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-line bg-canvas p-6 text-ink backdrop:bg-[rgb(0_0_0/0.5)]"
    >
      <h2 id={titleId} className="mb-4 text-xl font-semibold wrap-anywhere">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
