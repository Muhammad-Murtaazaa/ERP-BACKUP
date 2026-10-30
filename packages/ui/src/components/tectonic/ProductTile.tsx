import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export interface ProductTileProps {
  name: string;
  price: React.ReactNode;
  image?: string;
  icon?: IconName;
  onAdd?: () => void;
  className?: string;
}

export const ProductTile: React.FC<ProductTileProps> = ({
  name,
  price,
  image,
  icon = 'box',
  onAdd,
  className,
}) => {
  return (
    <div
      onClick={onAdd}
      className={twMerge(
        clsx(
          'relative p-4 rounded-[16px] bg-[var(--surface-raised,#171717)] border border-[var(--line,#262626)] hover:border-[var(--line-strong,#6b6b6b)]',
          'flex flex-col justify-between gap-3 text-left transition-all duration-150 select-none cursor-pointer group shadow-xs',
          className,
        ),
      )}
    >
      {/* Product Image / Icon box */}
      <div className="w-full h-24 rounded-[12px] bg-[var(--surface-strong,#2b2b2b)]/40 flex items-center justify-center overflow-hidden">
        {image ? (
          <img
            src={image}
            alt={name}
            className="w-full h-full object-contain p-2"
          />
        ) : (
          <span className="text-[var(--ink-muted,#a3a3a3)] group-hover:text-[var(--ink,#f5f5f5)] transition-colors">
            <Icon name={icon} size={32} strokeWidth={1.2} />
          </span>
        )}
      </div>

      {/* Info & Add button */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <h4 className="font-sans font-medium text-xs text-[var(--ink,#f5f5f5)] truncate leading-tight">
            {name}
          </h4>
          <span className="font-sans font-bold text-sm text-[var(--ink,#f5f5f5)] tabular-nums mt-0.5">
            {price}
          </span>
        </div>

        {/* Lime add disc in corner */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdd?.();
          }}
          title="Add to cart"
          aria-label={`Add ${name} to cart`}
          className="w-7 h-7 rounded-full bg-[var(--lime,#9df747)] hover:bg-[var(--lime-soft,#b5fc96)] text-[var(--on-lime,#0b0b0b)] flex items-center justify-center transition-transform active:scale-90 shrink-0 shadow-xs cursor-pointer"
        >
          <Icon name="plus" size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};
