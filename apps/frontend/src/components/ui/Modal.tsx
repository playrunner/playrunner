import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  className?: string;
  bodyClassName?: string;
  zIndex?: number;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  maxWidth = 'max-w-[600px]',
  className,
  bodyClassName,
  zIndex = 60,
}: ModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 sm:p-0"
      style={{ zIndex }}
    >
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative w-full bg-surface border border-strong rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] select-text',
          maxWidth,
          className,
        )}
      >
        {/* Header */}
        <div className="px-2 py-0.5 border-b border-subtle shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {icon && (
                <div className="w-5 h-5 flex items-center justify-center p-0.5">
                  {icon}
                </div>
              )}
              <div className="py-0.5">
                <h2 className="text-xs font-semibold text-[var(--foreground)] leading-none">
                  {title}
                </h2>
                {subtitle ? (
                  <div className="mt-1 text-[11px] leading-snug text-muted">
                    {subtitle}
                  </div>
                ) : null}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-0.5 text-muted hover:text-[var(--foreground)] transition-colors rounded hover:bg-surface-hover shrink-0"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          className={cn(
            'overflow-y-auto flex-1 p-6 select-text',
            bodyClassName,
          )}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="p-4 border-t border-subtle shrink-0 bg-surface flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
