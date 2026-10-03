// A modal dialog on the native <dialog> element (focus containment, Esc and the backdrop
// come from the browser): the globe's "About" with the credits and "Keyboard shortcuts".
// A click on the backdrop closes it, and focus returns to whatever opened it.
// Ported from the Alex's Atlas reference site, apps/site/src/ui/dialogs.ts (`Dialog`;
// an imperative DOM class there, a React component with an imperative handle here,
// same markup and class names).
import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { IconButton } from './Icon';

export interface DialogHandle {
  /** Opens the dialog as a modal (no-op when it is open already). */
  open(): void;
  /** Closes the dialog (no-op when it is closed). */
  close(): void;
  /** Whether the dialog is open now (read from the element, so always current). */
  readonly isOpen: boolean;
}

export interface DialogProps {
  /** The element id; the title gets `${id}-title`. */
  id: string;
  title: string;
  subtitle?: string;
  /** Extra classes after `dialog` (e.g. `dialog--about`). */
  className?: string;
  children: ReactNode;
  onOpenChange?(open: boolean): void;
}

export const Dialog = forwardRef<DialogHandle, DialogProps>(function Dialog(
  { id, title, subtitle, className, children, onOpenChange },
  ref,
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  /** The element that had focus when the dialog opened; focus goes back there on close. */
  const opener = useRef<HTMLElement | null>(null);
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const titleId = `${id}-title`;

  useImperativeHandle(
    ref,
    () => ({
      open() {
        const el = dialog.current;
        if (!el || el.open) return;
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        el.showModal();
        if (body.current) body.current.scrollTop = 0;
        changed.current?.(true);
      },
      close() {
        const el = dialog.current;
        if (el?.open) el.close();
      },
      get isOpen() {
        return dialog.current?.open === true;
      },
    }),
    [],
  );

  // Fires for every way of closing: the close button, Esc, the backdrop, `close()`.
  const onClose = () => {
    const back = opener.current;
    opener.current = null;
    changed.current?.(false);
    if (back?.isConnected) back.focus({ preventScroll: true });
  };

  // A click on the backdrop (the dialog element itself, outside its content box) closes it.
  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    const el = dialog.current;
    if (!el || e.target !== el) return;
    const r = el.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) el.close();
  };

  return (
    <dialog
      ref={dialog}
      id={id}
      className={`dialog ${className ?? ''}`.trim()}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={onClick}
    >
      <header className="dialog__head">
        <div>
          <h2 id={titleId} className="dialog__title">
            {title}
          </h2>
          {subtitle ? <p className="dialog__sub">{subtitle}</p> : null}
        </div>
        <IconButton
          icon="close"
          label="Close"
          title="Close (Esc)"
          className="dialog__close"
          onClick={() => dialog.current?.close()}
        />
      </header>
      <div ref={body} className="dialog__body">
        {children}
      </div>
    </dialog>
  );
});
