import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';
import { QuantityStepper } from './QuantityStepper.js';

export interface CartLineProps {
  name: string;
  price: React.ReactNode;
  qty?: number;
  onQty?: (n: number) => void;
  total?: React.ReactNode;
  image?: string;
  icon?: IconName;
  onRemove?: () => void;
  className?: string;
}

export const CartLine: React.FC<CartLineProps> = ({
  name,
  price,
  qty = 1,
  onQty,
  total,
  image,
  icon = 'box',
  onRemove,
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'w-full flex items-center justify-between gap-3 p-3 rounded-[12px] bg-[var(--surface-raised,#171717)] border border-[var(--line,#262626)] select-none text-left',
          className,
        ),
      )}
    >
      {/* Thumbnail + Name & Unit Price */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-[8px] bg-[var(--surface-strong,#2b2b2b)] flex items-center justify-center shrink-0 overflow-hidden">
          {image ? (
            <img src={image} alt={name} className="w-full h-full object-contain" />
          ) : (
            <span className="text-[var(--ink-muted,#a3a3a3)]">
              <Icon name={icon} size={16} />
            </span>
          )}
        </div>

        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-[var(--ink,#f5f5f5)] truncate leading-tight">
            {name}
          </span>
          <span className="text-[11px] font-mono tabular-nums text-[var(--ink-muted,#a3a3a3)]">
            {price}
          </span>
        </div>
      </div>

      {/* Stepper + Total + Remove */}
      <div className="flex items-center gap-3 shrink-0">
        <QuantityStepper
          value={qty}
          min={1}
          onChange={onQty}
          label={`${name} quantity`}
        />

        {total && (
          <span className="text-xs font-mono font-bold text-[var(--ink,#f5f5f5)] tabular-nums min-w-[50px] text-right">
            {total}
          </span>
        )}

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove item"
            aria-label={`Remove ${name} from cart`}
            className="p-1 rounded-full text-[var(--ink-muted,#a3a3a3)] hover:text-[var(--danger-text,#ff9f87)] transition-colors cursor-pointer"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
