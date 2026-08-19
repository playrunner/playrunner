import { useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
      maxWidth="max-w-md"
      bodyClassName="p-5"
      dialogRole="alertdialog"
      ariaDescribedBy={descriptionId}
      initialFocusRef={cancelButtonRef}
      footer={
        <>
          <Button ref={cancelButtonRef} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p id={descriptionId} className="text-sm leading-relaxed text-muted">
        {description}
      </p>
    </Modal>
  );
}
