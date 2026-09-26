import { useId, useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from './Button';

export interface FilePickerProps {
  ariaLabel: string;
  accept?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
  onFileSelected: (file: File) => void;
}

export function FilePicker({
  ariaLabel,
  accept,
  label = 'Choose file',
  hint,
  disabled,
  onFileSelected,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        className="gap-2"
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {label}
      </Button>
      {hint && (
        <span id={hintId} className="text-xs text-muted">
          {hint}
        </span>
      )}
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        aria-label={ariaLabel}
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onFileSelected(file);
        }}
      />
    </div>
  );
}
