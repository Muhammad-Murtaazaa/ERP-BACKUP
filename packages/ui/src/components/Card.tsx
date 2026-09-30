import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps {
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  headerAction,
  children,
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'bg-white border border-[#D9DFEA] rounded-[10px] shadow-sm p-5 text-left',
          className,
        ),
      )}
    >
      {(title || headerAction) && (
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#D9DFEA]">
          <div>
            {title && <h3 className="text-base font-semibold text-[#182235]">{title}</h3>}
            {subtitle && <p className="text-xs text-[#5E6A7D] mt-0.5">{subtitle}</p>}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
};
