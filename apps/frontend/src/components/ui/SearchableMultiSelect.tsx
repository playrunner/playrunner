import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SearchableMultiSelectOption {
  value: string;
  label: string;
  keywords?: string[];
}

export interface SearchableMultiSelectProps {
  options: SearchableMultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  ariaLabel?: string;
  disabled?: boolean;
  expandOnOpen?: boolean;
  className?: string;
}

export function SearchableMultiSelect({
  options,
  selectedValues,
  onChange,
  placeholder = 'Select options',
  searchPlaceholder = 'Search options...',
  emptyMessage = 'No matching options.',
  ariaLabel,
  disabled = false,
  expandOnOpen = false,
  className,
}: SearchableMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuId = useId();

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;

    return options.filter((option) =>
      [option.label, ...(option.keywords ?? [])]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const displayText = useMemo(() => {
    if (selectedValues.length === 0) return placeholder;
    if (selectedValues.length === 1) {
      return (
        options.find((option) => option.value === selectedValues[0])?.label ??
        placeholder
      );
    }
    return `${selectedValues.length} selected`;
  }, [options, placeholder, selectedValues]);

  const toggleOption = (value: string) => {
    onChange(
      selectedSet.has(value)
        ? selectedValues.filter((selectedValue) => selectedValue !== value)
        : [...selectedValues, value],
    );
  };

  return (
    <div className={cn('relative', className)} ref={rootRef}>
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel ?? placeholder}
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          setIsOpen((current) => !current);
          if (isOpen) setQuery('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !isOpen) {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
        className={cn(
          'flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-left text-sm transition-colors hover:border-[var(--border-strong)] focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-70',
          isOpen && 'border-[var(--border-strong)]',
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate',
            selectedValues.length === 0
              ? 'text-muted'
              : 'text-[var(--foreground)]',
          )}
        >
          {displayText}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {selectedValues.length > 0 ? (
            <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted">
              {selectedValues.length}
            </span>
          ) : null}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted transition-transform',
              isOpen && 'rotate-180',
            )}
          />
        </span>
      </button>

      {isOpen ? (
        <div
          id={menuId}
          className={cn(
            'z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-subtle bg-surface shadow-lg',
            expandOnOpen ? 'relative' : 'absolute',
          )}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setIsOpen(false);
              setQuery('');
              rootRef.current
                ?.querySelector<HTMLButtonElement>('[role="combobox"]')
                ?.focus();
            }
          }}
        >
          <div className="border-b border-subtle p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                ref={searchRef}
                type="search"
                role="searchbox"
                aria-label={searchPlaceholder.replace(/\.{3}$/, '')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-9 pr-3 text-sm text-[var(--foreground)] placeholder-[var(--muted)] transition-colors focus:border-[var(--border-strong)] focus:outline-none focus:ring-1 focus:ring-[var(--border-strong)]"
              />
            </div>
          </div>

          <div
            role="listbox"
            aria-multiselectable="true"
            className="custom-scrollbar max-h-60 overflow-y-auto p-1.5"
          >
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">
                {emptyMessage}
              </p>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selectedSet.has(option.value);
                return (
                  <label
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOption(option.value)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent)]'
                          : 'border-[var(--border-strong)] bg-[var(--background)]',
                      )}
                    >
                      {isSelected ? (
                        <Check className="h-3 w-3 text-[var(--accent-foreground)]" />
                      ) : null}
                    </span>
                    <span className="min-w-0 truncate">{option.label}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
