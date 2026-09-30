import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className,
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-all duration-150 rounded focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed select-none';

  const sizeStyles = {
    sm: 'px-2.5 py-1 text-xs font-semibold',
    md: 'px-3.5 py-1.5 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };

  const variantStyles = {
    primary:
      'bg-[#5940B8] hover:bg-[#463091] text-white border border-transparent shadow-sm focus:ring-[#5B3CC4]',
    secondary:
      'bg-white hover:bg-[#F1F4F9] text-[#182235] border border-[#D9DFEA] shadow-sm focus:ring-[#5B3CC4]',
    quiet:
      'bg-transparent hover:bg-[#F1F4F9] text-[#46536B] hover:text-[#182235] border-transparent',
    destructive:
      'bg-[#A82430] hover:bg-[#8e1f29] text-white border border-transparent shadow-sm focus:ring-red-400',
  };

  return (
    <button
      className={twMerge(clsx(baseStyles, sizeStyles[size], variantStyles[variant], className))}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-current" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Processing...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
};
