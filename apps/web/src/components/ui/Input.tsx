import React, { forwardRef } from "react";
import { cn } from "../../lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, ...props }, ref) => {
    return (
      <div className="relative w-full">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full bg-[var(--control-bg)] border border-[var(--border)] rounded-lg py-2 px-3 text-sm text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] transition-colors disabled:opacity-70 disabled:cursor-not-allowed",
            icon && "pl-9",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
Input.displayName = "Input";
