import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';

/**
 * Side drawer (Workman SideDrawer pattern, Omnysync tokens). Replaces centred
 * modals everywhere. Accessibility (design-system.md §Drawers, WCAG 2.2 AA):
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
  confirmMessage = 'Discard unsaved changes?',
  initialFocusRef,
  className,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);

  const requestClose = useCallback(() => {
    if (dirty && typeof window !== 'undefined' && !window.confirm(confirmMessage)) return;
    onClose();
  }, [dirty, confirmMessage, onClose]);

  useEffect(() => {
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isOpen) {
      openerRef.current = (document.activeElement as HTMLElement) || null;
      setMounted(true);
      raf = requestAnimationFrame(() => {
        timer = setTimeout(() => setVisible(true), 10);
      });
    } else if (mounted) {
      setVisible(false);
      timer = setTimeout(() => {
        setMounted(false);
        openerRef.current?.focus?.();
      }, 200);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Initial focus once visible.
  useEffect(() => {
    if (!visible || !panelRef.current) return;
    const target = initialFocusRef?.current || panelRef.current.querySelector<HTMLElement>(`[data-drawer-body] ${FOCUSABLE}`) || panelRef.current;
    target.focus();
  }, [visible, initialFocusRef]);

  // Escape + focus trap.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Let an open combobox consume Escape first.
        if ((e.target as HTMLElement)?.closest?.('[data-combobox-open="true"]')) return;
        e.stopPropagation();
        requestClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (nodes.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
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
        'fixed inset-0 z-50 flex justify-end bg-[#182235]/40 motion-safe:transition-opacity motion-safe:duration-200',
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
            'w-full h-full bg-white shadow-2xl border-l border-[#D9DFEA] flex flex-col focus:outline-none',
            'motion-safe:transition-transform motion-safe:duration-200',
            visible ? 'translate-x-0' : 'translate-x-full',
            width,
            className,
          ),
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#D9DFEA] shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-[#182235] leading-6 truncate">
              {title}
            </h2>
            {subtitle && (
              <p id={descId} className="text-[13px] text-[#5E6A7D] mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close panel"
            className="p-1.5 -mr-1.5 rounded-md text-[#5E6A7D] hover:text-[#182235] hover:bg-[#F1F4F9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div data-drawer-body className="flex-1 overflow-y-auto px-6 py-6">
          {children}
        </div>
        {footer && <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#D9DFEA] bg-[#F7F8FC] shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

/**
 * @deprecated Centred modals are retired (design-system.md §Drawers). `Modal`
 * now renders the side Drawer so any remaining call site gets the same
 * accessible behaviour.
 */
export const Modal = Drawer;
export type ModalProps = DrawerProps;
