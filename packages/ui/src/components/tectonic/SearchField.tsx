import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from './Icon.js';

export interface SearchFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  onScan?: () => void;
}

export const SearchField: React.FC<SearchFieldProps> = ({
  label = 'Search',
  placeholder = 'Search product, SKU or barcode…',
  onScan,
  className,
  value,
  onChange,
  ...props
}) => {
  return (
    <div className="relative flex items-center w-full">
      <span className="absolute left-4 text-[var(--ink-muted,#a3a3a3)] pointer-events-none flex items-center">
        <Icon name="search" size={18} />
      </span>
      <input
        type="text"
        aria-label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={twMerge(
          clsx(
            'w-full h-12 pl-11 pr-11 bg-[var(--surface-raised,#171717)] text-[var(--ink,#f5f5f5)] placeholder:text-[var(--ink-muted,#a3a3a3)]',
            'border border-[var(--line-strong,#6b6b6b)] rounded-full text-sm font-medium transition-all duration-150',
            'focus:outline-none focus:border-[var(--lime,#9df747)] focus:ring-1 focus:ring-[var(--lime,#9df747)]',
            className,
          ),
        )}
        {...props}
      />
      {onScan && (
        <button
          type="button"
          onClick={onScan}
          title="Scan barcode"
          aria-label="Scan barcode"
          className="absolute right-3.5 p-1 text-[var(--ink-muted,#a3a3a3)] hover:text-[var(--ink,#f5f5f5)] transition-colors cursor-pointer"
        >
          <Icon name="scan" size={18} />
        </button>
      )}
    </div>
  );
};
