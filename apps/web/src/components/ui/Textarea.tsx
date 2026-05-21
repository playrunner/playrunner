import React, { forwardRef } from "react";
import { cn } from "../../lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full bg-[var(--control-bg)] border border-[var(--border)] rounded-lg py-2 px-3 text-sm text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] transition-colors resize-y disabled:opacity-70 disabled:cursor-not-allowed",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
