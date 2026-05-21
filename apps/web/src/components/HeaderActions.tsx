import { useState, useRef, useEffect } from "react";
import { Sun, Moon, Monitor, ExternalLink, ChevronDown } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { cn } from "../lib/utils";

export function HeaderActions() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <div className="flex items-center gap-3 ml-auto">
      <a
        href="https://docs.playrunner.dev"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-[var(--foreground)] transition-colors"
      >
        Docs
        <ExternalLink className="w-3.5 h-3.5" />
      </a>

      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 rounded-md text-muted hover:text-[var(--foreground)] hover:bg-surface-hover transition-colors py-1 px-2"
          title="Change theme"
        >
          <ThemeIcon className="w-4 h-4" />
          <ChevronDown className={cn("w-3 h-3 transition-transform", isOpen && "rotate-180")} />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-1 w-36 bg-surface border border-subtle rounded-lg shadow-xl overflow-hidden z-50 py-1">
            <button
              onClick={() => { setTheme("light"); setIsOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                theme === "light"
                  ? "text-[var(--foreground)] bg-[var(--accent)]/10"
                  : "text-muted hover:text-[var(--foreground)] hover:bg-surface-hover"
              )}
            >
              <Sun className="w-4 h-4" />
              Light
            </button>
            <button
              onClick={() => { setTheme("dark"); setIsOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                theme === "dark"
                  ? "text-[var(--foreground)] bg-[var(--accent)]/10"
                  : "text-muted hover:text-[var(--foreground)] hover:bg-surface-hover"
              )}
            >
              <Moon className="w-4 h-4" />
              Dark
            </button>
            <button
              onClick={() => { setTheme("system"); setIsOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                theme === "system"
                  ? "text-[var(--foreground)] bg-[var(--accent)]/10"
                  : "text-muted hover:text-[var(--foreground)] hover:bg-surface-hover"
              )}
            >
              <Monitor className="w-4 h-4" />
              System
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
