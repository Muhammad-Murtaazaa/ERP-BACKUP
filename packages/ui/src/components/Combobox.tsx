import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Check, ChevronDown, Loader2, Lock, Search, X } from 'lucide-react';

/**
 * Searchable combobox (Workman SearchableSelect pattern, Omnysync tokens) used for
 * every select and lookup. Drop-in compatible with a native <select>: it accepts
 * <option>/<optgroup> children and calls `onChange` with an event-like object
 * ({ target: { value, name } }), so call sites migrate by renaming the tag.
 *
 * Accessibility (design-system.md §Combobox): role="combobox" trigger with
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
  error?: string;
  hint?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  'aria-label'?: string;
  'aria-describedby'?: string;
  autoFocus?: boolean;
}

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf((node.props as any).children);
  return '';
}

function collect(children: React.ReactNode, group?: string, out: ComboboxOption[] = []): ComboboxOption[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props: any = child.props;
    if (child.type === 'option') {
      const label = textOf(props.children);
      out.push({ value: props.value !== undefined ? String(props.value) : label, label, disabled: !!props.disabled, group });
    } else if (child.type === 'optgroup') {
      collect(props.children, props.label, out);
    } else if (child.type === React.Fragment) {
      collect(props.children, group, out);
    }
  });
  return out;
}

const SIZES = { sm: 'min-h-[32px] py-1 text-[13px]', md: 'min-h-[36px] py-2 text-sm', lg: 'min-h-[48px] py-3 text-base' } as const;

export const Combobox: React.FC<ComboboxProps> = (props) => {
  const {
    options: optionsProp,
    children,
    value: valueProp,
    defaultValue,
    onChange,
    onValueChange,
    onSearch,
    placeholder,
    searchPlaceholder = 'Type to search…',
    emptyText = 'No matches found',
    loading = false,
    deniedReason,
    disabled = false,
    required,
    clearable = false,
    name,
    id,
    label,
    error,
    hint,
    className,
    size = 'md',
    autoFocus,
  } = props;
  const options = useMemo(() => optionsProp ?? collect(children), [optionsProp, children]);
  const [inner, setInner] = useState<string>(defaultValue ?? '');
  const value = valueProp === undefined ? inner : valueProp === null ? '' : String(valueProp);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const autoId = useId();
  const baseId = id || `cb-${autoId.replace(/:/g, '')}`;
  const listId = `${baseId}-list`;
  const isDisabled = disabled || !!deniedReason;

  const selected = options.find((o) => o.value === value);
  // A leading empty-value option acts as the placeholder, like native selects.
  const placeholderText = placeholder ?? options.find((o) => o.value === '')?.label ?? 'Select…';
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = options.filter((o) => !(o.value === '' && !o.label.trim()));
    if (!q) return list;
    return list.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q) || (o.description || '').toLowerCase().includes(q) || (o.group || '').toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      const idx = filtered.findIndex((o) => o.value === value);
      setActive(idx >= 0 ? idx : filtered.findIndex((o) => !o.disabled));
      setTimeout(() => searchRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const emit = (v: string) => {
    if (valueProp === undefined) setInner(v);
    const ev: ComboboxChangeEvent = { target: { value: v, name }, currentTarget: { value: v, name } };
    onChange?.(ev);
    onValueChange?.(v, options.find((o) => o.value === v));
  };

  const choose = (o: ComboboxOption | undefined) => {
    if (!o || o.disabled) return;
    emit(o.value);
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  const move = (dir: 1 | -1) => {
    if (filtered.length === 0) return;
    let i = active;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + dir + filtered.length) % filtered.length;
      if (!filtered[i].disabled) break;
    }
    setActive(i);
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (isDisabled) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
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
        <label htmlFor={baseId} className="block text-[13px] font-semibold text-[#182235] mb-1">
          {label} {required && <span className="text-[#A82430]" aria-hidden="true">*</span>}
        </label>
      )}
      {name && <input type="hidden" name={name} value={value} />}
      {required && (
        // Keeps native form validation (required) working like the <select> it replaces.
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
          'w-full flex items-center justify-between gap-2 px-3 rounded-md border bg-white text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4] focus-visible:border-[#5940B8]',
          SIZES[size],
          error ? 'border-[#A82430]' : open ? 'border-[#5940B8] ring-1 ring-[#5B3CC4]' : 'border-[#7D8799] hover:border-[#5940B8]',
          isDisabled && 'bg-[#F1F4F9] text-[#5E6A7D] cursor-not-allowed hover:border-[#7D8799]',
        )}
      >
        <span className={clsx('truncate', selected && selected.value !== '' ? 'text-[#182235] font-medium' : 'text-[#5E6A7D]')}>
          {selected && selected.value !== '' ? selected.label : selected?.label || placeholderText}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-[#5E6A7D]">
          {loading && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
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
              className="p-0.5 rounded hover:bg-[#F1F4F9]"
            >
              <X size={14} aria-hidden="true" />
            </span>
          )}
          <ChevronDown size={16} className={clsx('motion-safe:transition-transform', open && 'rotate-180 text-[#5940B8]')} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div className="absolute z-[60] left-0 right-0 mt-1 min-w-[220px] bg-white rounded-[10px] border border-[#D9DFEA] shadow-xl overflow-hidden" onKeyDown={onListKey}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#D9DFEA] bg-[#F7F8FC]">
            <Search size={14} className="text-[#5E6A7D] shrink-0" aria-hidden="true" />
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
              className="w-full bg-transparent text-sm text-[#182235] placeholder-[#5E6A7D] outline-none"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={label || props['aria-label'] || 'Options'} className="max-h-64 overflow-y-auto p-1">
            {loading ? (
              <li className="px-3 py-4 text-center text-[13px] text-[#5E6A7D]" role="status">
                Loading…
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-[13px] text-[#5E6A7D]" role="status">
                <span className="block font-semibold text-[#182235]">{emptyText}</span>
                {query && <span className="block mt-0.5">Nothing matches “{query}”.</span>}
              </li>
            ) : (
              filtered.map((o, i) => {
                const isSel = o.value === value;
                const showGroup = o.group && (i === 0 || filtered[i - 1].group !== o.group);
                return (
                  <React.Fragment key={`${o.group || ''}:${o.value}:${i}`}>
                    {showGroup && <li className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#5E6A7D]" role="presentation">{o.group}</li>}
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
                        'flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm cursor-pointer select-none',
                        isSel ? 'bg-[#F2EEFF] text-[#463091] font-semibold' : i === active ? 'bg-[#F1F4F9] text-[#182235]' : 'text-[#182235]',
                        o.disabled && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{o.label || '—'}</span>
                        {o.description && <span className="block text-[12px] text-[#5E6A7D] truncate">{o.description}</span>}
                      </span>
                      {isSel && <Check size={14} className="text-[#5940B8] shrink-0" aria-hidden="true" />}
                    </li>
                  </React.Fragment>
                );
              })
            )}
          </ul>
        </div>
      )}
      {error && (
        <p id={`${baseId}-err`} className="mt-1 text-[12px] text-[#A82430]">
          {error}
        </p>
      )}
      {!error && (hint || deniedReason) && (
        <p id={`${baseId}-hint`} className="mt-1 text-[12px] text-[#5E6A7D]">
          {deniedReason || hint}
        </p>
      )}
    </div>
  );
};
