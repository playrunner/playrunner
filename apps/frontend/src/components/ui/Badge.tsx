import React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'danger' | 'outline';
  className?: string;
  children?: React.ReactNode;
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border',
        {
          'bg-[var(--surface-hover)] text-[var(--foreground)] border-[var(--border)]':
            variant === 'default',
          'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':
            variant === 'success',
          'bg-red-500/10 text-red-500 border-red-500/20': variant === 'danger',
          'bg-transparent text-[var(--muted)] border-[var(--border-strong)]':
            variant === 'outline',
        },
        className,
      )}
      {...props}
    />
  );
}
