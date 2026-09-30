import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className,
}) => {
  const baseStyles = 'inline-flex items-center font-medium rounded-full';

  const sizeStyles = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs font-semibold',
  };

  const variantStyles = {
    neutral: 'bg-[#F1F4F9] text-[#46536B] border border-[#D9DFEA]',
    brand: 'bg-[#F2EEFF] text-[#5940B8] border border-[#d2c7fc]',
    success: 'bg-[#EAF7EF] text-[#146341] border border-[#c3edd2]',
    warning: 'bg-[#FFF4D6] text-[#7A4700] border border-[#fae29f]',
    danger: 'bg-[#FDECEF] text-[#A82430] border border-[#f7c2c9]',
    info: 'bg-[#EDF3FF] text-[#234FA3] border border-[#cbe0ff]',
  };

  return (
    <span className={twMerge(clsx(baseStyles, sizeStyles[size], variantStyles[variant], className))}>
      {children}
    </span>
  );
};
