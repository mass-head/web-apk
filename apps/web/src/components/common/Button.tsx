import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'glow' | 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  disabled,
  className = '',
  ...props
}) => {
  const baseStyles =
    'relative inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#E9C46A]/40 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2.5 gap-2',
    lg: 'text-base px-6 py-3.5 gap-2.5 font-semibold',
  };

  const variantStyles = {
    glow: 'bg-gradient-to-r from-[#285943] via-[#12372A] to-[#285943] text-[#E9C46A] hover:text-[#F7F4EA] border border-[#E9C46A]/50 shadow-glow-gold hover:border-[#E9C46A] hover:brightness-110 active:brightness-95',
    primary: 'bg-[#E9C46A] text-[#12372A] font-bold hover:bg-[#d4ab48] border border-[#E9C46A] shadow-md hover:shadow-[#E9C46A]/20',
    secondary: 'bg-[#12372A] text-[#F7F4EA] hover:bg-[#285943] border border-[#285943] hover:border-[#285943]/80 hover:text-white',
    ghost: 'bg-transparent text-[#F7F4EA]/80 hover:text-[#F7F4EA] hover:bg-[#285943]/30 border border-transparent',
    danger: 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/30 hover:border-rose-500/50',
  };

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin text-current" />
          <span>{children}</span>
        </>
      ) : (
        <>
          {leftIcon && <span className="shrink-0">{leftIcon}</span>}
          <span>{children}</span>
          {rightIcon && <span className="shrink-0">{rightIcon}</span>}
        </>
      )}
    </button>
  );
};
