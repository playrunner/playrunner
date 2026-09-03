import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  FolderPlus,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
} from 'lucide-react';
import { Button, Input, Select } from './ui';
import { Modal } from './ui/Modal';
import type { AppNodeType } from './NodeSelectorModal';
import { DEFAULT_PROJECT_NODE_TYPES } from '../lib/projectDefaults';

interface ProjectSettingsModalProps {
  mode?: 'create' | 'edit';
  isOpen: boolean;
  projectTitle: string;
  defaultNodeTypes: string[];
  availableNodeTypes: AppNodeType[];
  onClose: () => void;
  onSave: (settings: {
    title: string;
    defaultNodeTypes: string[];
  }) => Promise<void>;
}

export function ProjectSettingsModal({
  mode = 'edit',
  isOpen,
  projectTitle,
  defaultNodeTypes,
  availableNodeTypes,
  onClose,
  onSave,
}: ProjectSettingsModalProps) {
  const [title, setTitle] = useState(projectTitle);
  const [nodeTypes, setNodeTypes] = useState(defaultNodeTypes);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(projectTitle);
      setNodeTypes(defaultNodeTypes);
      setError('');
    }
  }, [defaultNodeTypes, isOpen, projectTitle]);

  const handleSave = async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      await onSave({ title: title.trim(), defaultNodeTypes: nodeTypes });
      onClose();
    } catch (saveError) {
      console.error(
        mode === 'create'
          ? 'Failed to create project:'
          : 'Failed to save project settings:',
        saveError,
      );
      setError(
        mode === 'create'
          ? 'The project could not be created. Please try again.'
          : 'The project settings could not be saved. Please try again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const updateNodeType = (index: number, nodeType: string) => {
    setNodeTypes((previous) =>
      previous.map((value, itemIndex) =>
        itemIndex === index ? nodeType : value,
      ),
    );
  };

  const moveNodeType = (index: number, offset: -1 | 1) => {
    setNodeTypes((previous) => {
      const destination = index + offset;
      if (destination < 0 || destination >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isSaving) onClose();
      }}
      title={mode === 'create' ? 'Create project' : 'Project settings'}
      subtitle={
        mode === 'create'
          ? 'Name the project and choose how its workflows begin.'
          : 'Manage the settings for this project.'
      }
      icon={
        mode === 'create' ? (
          <FolderPlus className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Settings className="h-4 w-4" aria-hidden="true" />
        )
      }
      initialFocusRef={mode === 'create' ? titleInputRef : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="gap-2"
            onClick={handleSave}
            disabled={!title.trim() || isSaving}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSaving
              ? mode === 'create'
                ? 'Creating…'
                : 'Saving…'
              : mode === 'create'
                ? 'Create project'
                : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <label
            htmlFor="project-settings-title"
            className="block text-sm font-medium text-[var(--foreground)]"
          >
            Project name
          </label>
          <Input
            ref={titleInputRef}
            id="project-settings-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onFocus={(event) => {
              if (mode === 'create') event.currentTarget.select();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleSave();
            }}
          />
        </div>

        <section className="space-y-3 border-t border-subtle pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-[var(--foreground)]">
                Starting nodes
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                New workflows start with these nodes in this order.
              </p>
            </div>
            <Button
              variant="tertiary"
              className="shrink-0 gap-2"
              onClick={() => setNodeTypes(DEFAULT_PROJECT_NODE_TYPES)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-subtle bg-[var(--surface-hover)] p-3 text-muted shadow-inner">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="text-xs leading-relaxed">
              {mode === 'create'
                ? 'These nodes will be added to the first workflow and used as defaults for new workflows.'
                : 'Changing these defaults only affects workflows created after you save. Existing workflows stay unchanged.'}
            </p>
          </div>

          <div className="space-y-2">
            {nodeTypes.map((nodeType, index) => (
              <div
                key={`${nodeType}-${index}`}
                className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-2"
              >
                <span className="w-6 shrink-0 text-center font-mono text-xs text-muted">
                  {index + 1}
                </span>
                <Select
                  aria-label={`Starting node ${index + 1}`}
                  value={nodeType}
                  onChange={(event) =>
                    updateNodeType(index, event.target.value)
                  }
                >
                  {availableNodeTypes.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => moveNodeType(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move starting node ${index + 1} up`}
                  title="Move up"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => moveNodeType(index, 1)}
                  disabled={index === nodeTypes.length - 1}
                  aria-label={`Move starting node ${index + 1} down`}
                  title="Move down"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setNodeTypes((previous) =>
                      previous.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  aria-label={`Remove starting node ${index + 1}`}
                  title="Remove node"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {nodeTypes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-subtle p-4 text-center text-xs text-muted">
              New workflows will start with a blank canvas.
            </p>
          ) : null}

          <Button
            variant="secondary"
            className="gap-2"
            onClick={() =>
              setNodeTypes((previous) => [
                ...previous,
                availableNodeTypes[0]?.id || 'playwright',
              ])
            }
            disabled={availableNodeTypes.length === 0}
          >
            <Plus className="h-4 w-4" />
            Add starting node
          </Button>
        </section>

        {error ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-red-500">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed">{error}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
