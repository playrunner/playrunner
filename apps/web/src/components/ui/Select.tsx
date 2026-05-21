import React, { forwardRef } from "react";
import { cn } from "../../lib/utils";
import { ChevronDown } from "lucide-react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative w-full">
        <select
          ref={ref}
          className={cn(
            "w-full bg-[var(--control-bg)] border border-[var(--border)] rounded-lg py-2 pl-3 pr-9 text-sm text-[var(--foreground)] appearance-none focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] transition-colors disabled:opacity-70 disabled:cursor-not-allowed",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
      </div>
    );
  }
);
Select.displayName = "Select";
