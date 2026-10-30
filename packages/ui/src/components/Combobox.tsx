import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Check, ChevronDown, Loader2, Lock, Search, X } from 'lucide-react';

/**
 * Searchable combobox (Tectonic Design System) used for
 * every select and lookup. Drop-in compatible with a native <select>: it accepts
 * <option>/<optgroup> children and calls `onChange` with an event-like object
 * ({ target: { value, name } }), so call sites migrate by renaming the tag.
 *
 * Accessibility: role="combobox" trigger with
 * aria-expanded/aria-controls/aria-activedescendant, listbox + options, full
 * keyboard support (Arrow keys, Home/End, Enter, Escape, Tab, type-to-search),
 * explicit loading / no-results / permission-denied states, and the selected
 * value's text always visible in the trigger.
 */
export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
  disabled?: boolean;
}

export interface ComboboxChangeEvent {
  target: { value: string; name?: string };
  currentTarget: { value: string; name?: string };
}

export interface ComboboxProps {
  options?: ComboboxOption[];
  children?: React.ReactNode;
  value?: string | number | null;
  defaultValue?: string;
  onChange?: (e: ComboboxChangeEvent) => void;
  onValueChange?: (value: string, option: ComboboxOption | undefined) => void;
  /** Called with the search text (e.g. for server-side lookups). */
  onSearch?: (query: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  /** When set the control is disabled and explains why (permission denied). */
  deniedReason?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  name?: string;
  id?: string;
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

const SIZES = {
  sm: 'min-h-8 text-xs py-1',
  md: 'min-h-9 text-sm py-1.5',
  lg: 'min-h-11 text-base py-2.5',
} as const;

/** Extract options from <option> and <optgroup> React children if passed. */
function parseChildren(children: React.ReactNode): ComboboxOption[] {
  const result: ComboboxOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === 'option') {
      const p = child.props as any;
      result.push({
        value: String(p.value ?? p.children ?? ''),
        label: typeof p.children === 'string' ? p.children : String(p.value ?? ''),
        disabled: Boolean(p.disabled),
      });
    } else if (child.type === 'optgroup') {
      const p = child.props as any;
      const group = String(p.label ?? '');
      React.Children.forEach(p.children, (optChild) => {
        if (!React.isValidElement(optChild)) return;
        const op = optChild.props as any;
        result.push({
          value: String(op.value ?? op.children ?? ''),
          label: typeof op.children === 'string' ? op.children : String(op.value ?? ''),
          disabled: Boolean(op.disabled),
          group,
        });
      });
    }
  });
  return result;
}

export const Combobox: React.FC<ComboboxProps> = ({
  options: optionsProp,
  children,
  value: valueProp,
  defaultValue,
  onChange,
  onValueChange,
  onSearch,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matching options',
  loading = false,
  deniedReason,
  disabled = false,
  required = false,
  clearable = false,
  name,
  id,
  label,
  hint,
  error,
  size = 'md',
  className,
  autoFocus = false,
  ...props
}) => {
  const generatedId = useId();
  const baseId = id || `cb-${generatedId.replace(/:/g, '')}`;
  const listId = `${baseId}-list`;

  const childOptions = useMemo(() => (children ? parseChildren(children) : undefined), [children]);
  const allOptions = optionsProp ?? childOptions ?? [];

  const [uncontrolledValue, setUncontrolledValue] = useState<string>(
    defaultValue !== undefined ? String(defaultValue) : '',
  );
  const isControlled = valueProp !== undefined;
  const rawValue = isControlled ? (valueProp === null ? '' : String(valueProp)) : uncontrolledValue;
  const value = rawValue;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<number>(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const isDisabled = disabled || Boolean(deniedReason);

  // Selected option lookup
  const selected = useMemo(() => allOptions.find((o) => o.value === value), [allOptions, value]);

  // Filter options based on query
  const filtered = useMemo(() => {
    if (!query.trim()) return allOptions;
    const q = query.toLowerCase();
    return allOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.description && o.description.toLowerCase().includes(q)),
    );
  }, [allOptions, query]);

  // Emit synthetic change event compatible with native select onChange
  const emit = (nextVal: string) => {
    if (!isControlled) setUncontrolledValue(nextVal);
    const chosenOpt = allOptions.find((o) => o.value === nextVal);
    onValueChange?.(nextVal, chosenOpt);
    if (onChange) {
      const synthetic = {
        target: { value: nextVal, name },
        currentTarget: { value: nextVal, name },
      };
      onChange(synthetic as ComboboxChangeEvent);
    }
  };

  const choose = (opt: ComboboxOption | undefined) => {
    if (!opt || opt.disabled) return;
    emit(opt.value);
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      setActive(filtered.findIndex((o) => o.value === value));
      const t = setTimeout(() => searchRef.current?.focus(), 20);
      return () => clearTimeout(t);
    } else {
      setQuery('');
      setActive(-1);
    }
  }, [open]);

  // Scroll active option into view
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const move = (delta: number) => {
    if (!filtered.length) return;
    let next = active;
    for (let i = 0; i < filtered.length; i++) {
      next = (next + delta + filtered.length) % filtered.length;
      if (!filtered[next].disabled) {
        setActive(next);
        return;
      }
    }
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (isDisabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setQuery(e.key);
      setOpen(true);
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActive(filtered.findIndex((o) => !o.disabled));
        break;
      case 'End':
        e.preventDefault();
        for (let i = filtered.length - 1; i >= 0; i--) if (!filtered[i].disabled) return setActive(i);
        break;
      case 'Enter':
        e.preventDefault();
        choose(filtered[active] ?? (filtered.length === 1 ? filtered[0] : undefined));
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const describedBy = [props['aria-describedby'], error ? `${baseId}-err` : hint || deniedReason ? `${baseId}-hint` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div ref={rootRef} className={twMerge(clsx('relative w-full text-left', className))} data-combobox-open={open ? 'true' : 'false'}>
      {label && (
        <label htmlFor={baseId} className="block text-[13px] font-semibold text-[var(--ink)] mb-1">
          {label} {required && <span className="text-[var(--danger)]" aria-hidden="true">*</span>}
        </label>
      )}
      {name && <input type="hidden" name={name} value={value} />}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value ?? ''}
          onChange={() => undefined}
          onFocus={() => triggerRef.current?.focus()}
          className="absolute bottom-0 left-4 h-px w-px opacity-0 pointer-events-none"
        />
      )}
      <button
        ref={triggerRef}
        id={baseId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={props['aria-label']}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-disabled={isDisabled || undefined}
        aria-describedby={describedBy}
        disabled={isDisabled}
        autoFocus={autoFocus}
        title={deniedReason}
        onClick={() => !isDisabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        className={clsx(
          'w-full flex items-center justify-between gap-2 px-3 rounded-lg border bg-[var(--surface)] text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lime)] focus-visible:border-[var(--lime)]',
          SIZES[size],
          error ? 'border-[var(--danger)]' : open ? 'border-[var(--lime)] ring-1 ring-[var(--lime)]' : 'border-[var(--line-strong)] hover:border-[var(--lime)]',
          isDisabled && 'bg-[var(--surface-muted)] text-[var(--ink-subtle)] cursor-not-allowed hover:border-[var(--line)]',
        )}
      >
        <span className={clsx('truncate', selected && selected.value !== '' ? 'text-[var(--ink)] font-medium' : 'text-[var(--ink-subtle)]')}>
          {selected && selected.value !== '' ? selected.label : selected?.label || placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-[var(--ink-muted)]">
          {loading && <Loader2 size={14} className="motion-safe:animate-spin text-[var(--lime)]" aria-hidden="true" />}
          {deniedReason && <Lock size={14} aria-hidden="true" />}
          {clearable && value && !isDisabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              onClick={(e) => {
                e.stopPropagation();
                emit('');
              }}
              className="p-0.5 rounded-full hover:bg-[var(--surface-raised)]"
            >
              <X size={14} aria-hidden="true" />
            </span>
          )}
          <ChevronDown size={16} className={clsx('motion-safe:transition-transform', open && 'rotate-180 text-[var(--lime)]')} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div className="absolute z-[60] left-0 right-0 mt-1 min-w-[220px] bg-[var(--surface)] text-[var(--ink)] rounded-xl border border-[var(--line)] shadow-2xl overflow-hidden" onKeyDown={onListKey}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--line)] bg-[var(--surface-strong)]">
            <Search size={14} className="text-[var(--ink-muted)] shrink-0" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              role="searchbox"
              aria-label="Filter options"
              aria-controls={listId}
              aria-activedescendant={active >= 0 ? `${baseId}-opt-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                onSearch?.(e.target.value);
              }}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm text-[var(--ink)] placeholder-[var(--ink-subtle)] outline-none"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={label || props['aria-label'] || 'Options'} className="max-h-64 overflow-y-auto p-1">
            {loading ? (
              <li className="px-3 py-4 text-center text-[13px] text-[var(--ink-muted)]" role="status">
                Loading…
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-[13px] text-[var(--ink-muted)]" role="status">
                <span className="block font-semibold text-[var(--ink)]">{emptyText}</span>
                {query && <span className="block mt-0.5 text-[var(--ink-subtle)]">Nothing matches “{query}”.</span>}
              </li>
            ) : (
              filtered.map((o, i) => {
                const isSel = o.value === value;
                const showGroup = o.group && (i === 0 || filtered[i - 1].group !== o.group);
                return (
                  <React.Fragment key={`${o.group || ''}:${o.value}:${i}`}>
                    {showGroup && <li className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-subtle)]" role="presentation">{o.group}</li>}
                    <li
                      id={`${baseId}-opt-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={isSel}
                      aria-disabled={o.disabled || undefined}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                      className={clsx(
                        'flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer select-none transition-colors',
                        isSel ? 'bg-[var(--lime-soft)] text-[var(--lime)] font-semibold' : i === active ? 'bg-[var(--surface-raised)] text-[var(--ink)]' : 'text-[var(--ink)]',
                        o.disabled && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{o.label || '—'}</span>
                        {o.description && <span className="block text-[12px] text-[var(--ink-muted)] truncate">{o.description}</span>}
                      </span>
                      {isSel && <Check size={14} className="shrink-0 text-[var(--lime)]" aria-hidden="true" />}
                    </li>
                  </React.Fragment>
                );
              })
            )}
          </ul>
        </div>
      )}

      {error && (
        <span id={`${baseId}-err`} className="block mt-1 text-xs text-[var(--danger)]" aria-live="polite">
          {error}
        </span>
      )}
      {hint && !error && (
        <span id={`${baseId}-hint`} className="block mt-1 text-xs text-[var(--ink-muted)]">
          {hint}
        </span>
      )}
      {deniedReason && !error && !hint && (
        <span id={`${baseId}-hint`} className="block mt-1 text-xs text-[var(--ink-subtle)]">
          {deniedReason}
        </span>
      )}
    </div>
  );
};
