import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';

/**
 * Side drawer (Tectonic Design System). Replaces centred
 * modals everywhere. Accessibility (WCAG 2.2 AA):
 *  - role="dialog" + aria-modal, named by its title (aria-labelledby)
 *  - focus moves into the drawer on open, Tab/Shift+Tab are trapped inside it
 *  - Escape and backdrop click close it; when `dirty` is set the user must
 *    confirm discarding unsaved changes first
 *  - focus is restored to the element that opened it
 *  - respects prefers-reduced-motion (transition classes use motion-safe)
 */
export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Drawer width. `maxWidth` is accepted for backwards compatibility with Modal. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  /** When true, closing asks for confirmation (unsaved changes). */
  dirty?: boolean;
  confirmMessage?: string;
  /** Element to focus first; defaults to the first focusable control in the body. */
  initialFocusRef?: React.RefObject<HTMLElement>;
  className?: string;
}

const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="combobox"]:not([aria-disabled="true"])';

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size,
  maxWidth,
  dirty = false,
  confirmMessage = 'You have unsaved changes. Discard them and close?',
  initialFocusRef,
  className,
}) => {
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const requestClose = useCallback(() => {
    if (dirty) {
      if (!window.confirm(confirmMessage)) return;
    }
    onClose();
  }, [dirty, confirmMessage, onClose]);

  // Mount/unmount animation sequencing
  useEffect(() => {
    if (isOpen) {
      lastActiveRef.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    } else if (mounted) {
      setVisible(false);
      const timer = setTimeout(() => {
        setMounted(false);
        lastActiveRef.current?.focus?.();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen, mounted]);

  // Lock body scroll while open
  useEffect(() => {
    if (!mounted) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = orig;
    };
  }, [mounted]);

  // Focus placement on open
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      if (first) first.focus();
      else panelRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [visible, initialFocusRef]);

  // Trap focus & escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null,
      );
      if (!nodes.length) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isOpen, requestClose]);

  if (!mounted) return null;
  const width = WIDTHS[size || maxWidth || 'lg'];

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm motion-safe:transition-opacity motion-safe:duration-200',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descId : undefined}
        tabIndex={-1}
        className={twMerge(
          clsx(
            'w-full h-full bg-[var(--surface)] text-[var(--ink)] shadow-2xl border-l border-[var(--line)] flex flex-col focus:outline-none',
            'motion-safe:transition-transform motion-safe:duration-200',
            visible ? 'translate-x-0' : 'translate-x-full',
            width,
            className,
          ),
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--line)] shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-[var(--ink)] leading-6 truncate">
              {title}
            </h2>
            {subtitle && (
              <p id={descId} className="text-[13px] text-[var(--ink-muted)] mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close panel"
            onClick={requestClose}
            className="p-1.5 -mr-1.5 -mt-1 rounded-full text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 text-[var(--ink)]">{children}</div>

        {footer && (
          <div className="px-6 py-4 border-t border-[var(--line)] bg-[var(--surface-strong)] shrink-0 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
