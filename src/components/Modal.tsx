import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './Icons';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

// Reference-counted body scroll lock & Escape stack so stacked modals close one layer at a time
let activeModalCount = 0;
let originalBodyOverflow = '';
const modalCloseStack: Array<() => void> = [];

/**
 * Portal-based Modal compliant with Mobile & iOS Safari rules:
 * - Rendered in document.body to avoid ancestor transform/filter issues
 * - Uses 100svh max-height + safe-area insets + internal scroll body
 * - Handles Escape key (top-most modal only), reference-counted scroll lock, and focus restoration
 */
export function Modal({ open, title, onClose, children, footer, wide = false }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    if (activeModalCount === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    activeModalCount += 1;

    const closeSelf = () => onCloseRef.current();
    modalCloseStack.push(closeSelf);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && modalCloseStack[modalCloseStack.length - 1] === closeSelf) {
        event.preventDefault();
        closeSelf();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Move initial focus cleanly into the modal panel only once when opened
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        panel.focus();
      }
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      const idx = modalCloseStack.lastIndexOf(closeSelf);
      if (idx >= 0) modalCloseStack.splice(idx, 1);
      activeModalCount = Math.max(0, activeModalCount - 1);
      if (activeModalCount === 0) {
        document.body.style.overflow = originalBodyOverflow;
      }
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={`modal-panel ${wide ? 'modal-panel--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
