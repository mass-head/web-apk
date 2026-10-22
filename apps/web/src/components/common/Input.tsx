import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  requiredMark?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      requiredMark,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || (label ? label.toLowerCase().replace(/[^a-z0-9]/g, '-') : undefined);
    const helperId = inputId ? `${inputId}-helper` : undefined;
    const errorId = inputId ? `${inputId}-error` : undefined;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold text-[#F7F4EA]/90 uppercase tracking-wider mb-2"
          >
            {label}
            {requiredMark && <span className="text-[#E9C46A] ml-1">*</span>}
          </label>
        )}

        <div className="relative rounded-xl">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#F7F4EA]/50">
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            className={`w-full bg-[#12372A] border rounded-xl px-4 py-2.5 text-sm text-[#F7F4EA] placeholder-[#F7F4EA]/40 transition-all duration-200 outline-none
              ${leftIcon ? 'pl-10' : ''}
              ${rightIcon ? 'pr-10' : ''}
              ${
                error
                  ? 'border-rose-500/70 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20'
                  : 'border-[#285943] hover:border-[#E9C46A]/60 focus:border-[#E9C46A] focus:ring-2 focus:ring-[#E9C46A]/20'
              }
              ${props.disabled ? 'opacity-50 cursor-not-allowed bg-[#202820]' : ''}
              ${className}
            `}
            {...props}
          />

          {rightIcon && (
            <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#F7F4EA]/50">
              {rightIcon}
            </div>
          )}
        </div>

        {error ? (
          <p id={errorId} className="mt-1.5 text-xs text-rose-400 font-medium flex items-center gap-1">
            <span>•</span> {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className="mt-1.5 text-xs text-[#F7F4EA]/60">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
