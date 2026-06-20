import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";

export interface Option {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  options: Option[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelectDropdown({
  options,
  selectedValues,
  onChange,
  placeholder = "Select options",
  className,
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggleOption = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const getDisplayText = () => {
    if (selectedValues.length === 0) return placeholder;
    if (selectedValues.length === 1) {
      return options.find((o) => o.value === selectedValues[0])?.label || placeholder;
    }
    return `${selectedValues.length} selected`;
  };

  return (
    <div className={cn("relative", className)} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-between w-full px-3 py-2 text-sm text-[var(--foreground)] bg-control border border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 hover:border-[var(--border-strong)] transition-colors",
          isOpen && "border-[var(--border-strong)]"
        )}
      >
        <span className={selectedValues.length === 0 ? "text-muted" : "text-[var(--foreground)]"}>
          {getDisplayText()}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-muted transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-surface border border-subtle rounded-lg shadow-lg overflow-hidden flex flex-col max-h-60">
          <div className="overflow-y-auto p-1 py-1 custom-scrollbar">
            {options.map((option) => {
              const isSelected = selectedValues.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleToggleOption(option.value)}
                  className="flex items-center w-full px-2 py-2 text-sm text-[var(--foreground)] hover:bg-surface-hover rounded-md transition-colors"
                >
                  <div
                    className={cn(
                      "w-4 h-4 rounded-sm border mr-3 flex items-center justify-center transition-colors shrink-0",
                      isSelected
                        ? "bg-[var(--accent)] border-[var(--accent)]"
                        : "border-[var(--border-strong)] bg-[var(--background)]"
                    )}
                  >
                    {isSelected && <Check className="w-3 h-3 text-[var(--accent-foreground)]" />}
                  </div>
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
