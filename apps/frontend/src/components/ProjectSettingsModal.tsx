import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { Button, Input } from './ui';
import { Modal } from './ui/Modal';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  projectTitle: string;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}

export function ProjectSettingsModal({
  isOpen,
  projectTitle,
  onClose,
  onSave,
}: ProjectSettingsModalProps) {
  const [title, setTitle] = useState(projectTitle);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setTitle(projectTitle);
  }, [isOpen, projectTitle]);

  const handleSave = async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(title.trim());
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Project settings"
      subtitle="Manage the settings for this project."
      icon={<Settings className="h-4 w-4" aria-hidden="true" />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!title.trim() || isSaving}
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <label
          htmlFor="project-settings-title"
          className="block text-sm font-medium text-[var(--foreground)]"
        >
          Project name
        </label>
        <Input
          id="project-settings-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleSave();
          }}
        />
      </div>
    </Modal>
  );
}
