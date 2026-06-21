import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { Upload, Search, ChevronDown } from 'lucide-react';
import { auth } from '../../lib/auth';
import { DbAPI } from '../../lib/db';
import type { EnvVar, SavedEnvironment } from './types';
import { VariablesTable } from './VariablesTable';

interface EnvironmentConfigPanelProps {
  nodeId: string;
  nodeLabel?: string;
  config: Record<string, any>;
  onChange: (nodeId: string, newConfig: Record<string, any>) => void;
  className?: string;
  onPointerDown?: (e: React.PointerEvent) => void;
  onLabelChange?: (newLabel: string) => void;
}

export const EnvironmentConfigPanel: React.FC<EnvironmentConfigPanelProps> = ({
  nodeId,
  nodeLabel,
  config,
  onChange,
  className,
  onPointerDown,
  onLabelChange,
}) => {
  const [variables, setVariables] = useState<EnvVar[]>(() => {
    const initial = (
      Array.isArray(config.variables) ? config.variables : []
    ).map((v: any) => ({
      ...v,
      enabled: v.enabled !== undefined ? v.enabled : true,
    }));
    const last = initial[initial.length - 1];
    if (!last || last.key || last.initialValue || last.currentValue) {
      return [
        ...initial,
        {
          id: Math.random().toString(36).substring(7),
          key: '',
          type: 'default',
          initialValue: '',
          currentValue: '',
          enabled: true,
        },
      ];
    }
    return initial;
  });

  const [filterText, setFilterText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [savedEnvironments, setSavedEnvironments] = useState<
    SavedEnvironment[]
  >([]);
  const [linkedEnvId, setLinkedEnvId] = useState<string | null>(
    config.environmentId || null,
  );
  const [dropdownEnvId, setDropdownEnvId] = useState<string>(
    config.environmentId || '__create_new__',
  );
  const [isLoadingEnvs, setIsLoadingEnvs] = useState(false);
  const initializedRef = useRef(false);
  const currentUserId = auth.currentUser?.uid;

  useEffect(() => {
    if (!currentUserId) return;
    setIsLoadingEnvs(true);
    DbAPI.getEnvironments(currentUserId)
      .then((envs) => {
        setSavedEnvironments(envs);
        const linkedEnv = envs.find((e) => e.id === config.environmentId);
        if (linkedEnv) {
          setDropdownEnvId(linkedEnv.id);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoadingEnvs(false));
  }, [config.environmentId, currentUserId]);

  useEffect(() => {
    if (
      linkedEnvId &&
      savedEnvironments.length > 0 &&
      !initializedRef.current
    ) {
      const env = savedEnvironments.find((e) => e.id === linkedEnvId);
      if (env && env.variables) {
        const loadedVars = env.variables.map((v) => ({
          ...v,
          enabled: v.enabled !== undefined ? v.enabled : true,
        }));
        const last = loadedVars[loadedVars.length - 1];
        if (!last || last.key || last.initialValue || last.currentValue) {
          loadedVars.push({
            id: Math.random().toString(36).substring(7),
            key: '',
            type: 'default',
            initialValue: '',
            currentValue: '',
            enabled: true,
          });
        }
        setVariables(loadedVars);
        initializedRef.current = true;
      }
    }
    if (!linkedEnvId && !initializedRef.current) {
      initializedRef.current = true;
    }
  }, [savedEnvironments, linkedEnvId]);

  useEffect(() => {
    const validVars = variables.filter(
      (v) => v.key || v.initialValue || v.currentValue,
    );
    const updatedConfig: Record<string, any> = { variables: validVars };
    if (linkedEnvId) {
      updatedConfig['environmentId'] = linkedEnvId;
    } else {
      updatedConfig['environmentId'] = null;
    }
    onChange(nodeId, updatedConfig);
  }, [variables, linkedEnvId, nodeId, onChange]);

  useEffect(() => {
    const lastVar = variables[variables.length - 1];
    if (
      !lastVar ||
      lastVar.key ||
      lastVar.initialValue ||
      lastVar.currentValue
    ) {
      setVariables((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          key: '',
          type: 'default',
          initialValue: '',
          currentValue: '',
          enabled: true,
        },
      ]);
    }
  }, [variables]);

  const syncToSavedEnvironment = (vars: EnvVar[]) => {
    if (!linkedEnvId || !auth.currentUser) return;
    const env = savedEnvironments.find((e) => e.id === linkedEnvId);
    if (!env) return;
    const validVars = vars.filter(
      (v) => v.key || v.initialValue || v.currentValue,
    );
    DbAPI.saveEnvironment(auth.currentUser.uid, linkedEnvId, {
      ...env,
      variables: validVars,
    }).catch(console.error);
  };

  const updateVar = (id: string, updates: Partial<EnvVar>) => {
    setVariables((prev) => {
      const next = prev.map((v) => (v.id === id ? { ...v, ...updates } : v));
      if (linkedEnvId) syncToSavedEnvironment(next);
      return next;
    });
  };

  const removeVar = (id: string) => {
    setVariables((prev) => {
      const next = prev.filter((v) => v.id !== id);
      if (linkedEnvId) syncToSavedEnvironment(next);
      return next;
    });
  };

  const toggleEnabled = (id: string) => {
    setVariables((prev) => {
      const next = prev.map((v) =>
        v.id === id ? { ...v, enabled: !v.enabled } : v,
      );
      if (linkedEnvId) syncToSavedEnvironment(next);
      return next;
    });
  };

  const handleSelectEnvironment = (envId: string) => {
    setDropdownEnvId(envId);
    if (envId === '__create_new__') {
      setLinkedEnvId(null);
      onChange(nodeId, {
        variables: variables.filter(
          (v) => v.key || v.initialValue || v.currentValue,
        ),
        environmentId: null,
      });
      if (onLabelChange) onLabelChange('My Prod Env'); // default? Maybe just "Environment" or keep nodeLabel
    } else {
      const env = savedEnvironments.find((e) => e.id === envId);
      if (env) {
        setLinkedEnvId(env.id);
        const loadedVars = env.variables.map((v) => ({
          ...v,
          enabled: v.enabled !== undefined ? v.enabled : true,
        }));
        const last = loadedVars[loadedVars.length - 1];
        if (!last || last.key || last.initialValue || last.currentValue) {
          loadedVars.push({
            id: Math.random().toString(36).substring(7),
            key: '',
            type: 'default',
            initialValue: '',
            currentValue: '',
            enabled: true,
          });
        }
        setVariables(loadedVars);
        const validVars = loadedVars.filter(
          (v) => v.key || v.initialValue || v.currentValue,
        );
        onChange(nodeId, { variables: validVars, environmentId: env.id });
        if (onLabelChange) onLabelChange(env.name);
      }
    }
  };

  const handleToggleGlobal = async (checked: boolean) => {
    if (!auth.currentUser) return;
    if (checked) {
      if (dropdownEnvId !== '__create_new__') {
        setLinkedEnvId(dropdownEnvId);
        const env = savedEnvironments.find((e) => e.id === dropdownEnvId);
        if (env) {
          const validVars = variables.filter(
            (v) => v.key || v.initialValue || v.currentValue,
          );
          DbAPI.saveEnvironment(auth.currentUser.uid, dropdownEnvId, {
            ...env,
            variables: validVars,
          }).catch(console.error);
          onChange(nodeId, {
            variables: validVars,
            environmentId: dropdownEnvId,
          });
        }
      } else {
        const validVars = variables.filter(
          (v) => v.key || v.initialValue || v.currentValue,
        );
        const name = nodeLabel || 'Environment';

        // Ensure global labels are unique
        const existing = savedEnvironments.find(
          (e) => e.name.toLowerCase() === name.toLowerCase(),
        );
        if (existing) {
          alert(
            `An environment with the name "${name}" already exists. Please choose a unique name.`,
          );
          return;
        }

        const envId = Date.now().toString(36);
        const now = new Date().toISOString();
        const newEnv: SavedEnvironment = {
          id: envId,
          userId: auth.currentUser.uid,
          name,
          variables: validVars,
          createdAt: now,
          updatedAt: now,
        };
        try {
          await DbAPI.saveEnvironment(auth.currentUser.uid, envId, newEnv);
          setLinkedEnvId(envId);
          setDropdownEnvId(envId);
          setSavedEnvironments((prev) => [...prev, newEnv]);
          onChange(nodeId, { variables: validVars, environmentId: envId });
        } catch (err) {
          console.error('Failed to save environment globally:', err);
        }
      }
    } else {
      setLinkedEnvId(null);
      onChange(nodeId, {
        variables: variables.filter(
          (v) => v.key || v.initialValue || v.currentValue,
        ),
        environmentId: null,
      });
    }
  };

  const filteredVariables = variables.filter(
    (v) =>
      v.key.toLowerCase().includes(filterText.toLowerCase()) ||
      v.initialValue.toLowerCase().includes(filterText.toLowerCase()) ||
      (v.key === '' && v.initialValue === '' && v.currentValue === ''),
  );

  const handleEnvFileContents = (content: string) => {
    const lines = content.split('\n');
    const newVars: EnvVar[] = [];

    for (const line of lines) {
      if (line.trim().startsWith('#') || !line.trim()) continue;
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        newVars.push({
          id: Math.random().toString(36).substring(7),
          key,
          type: 'default',
          initialValue: value,
          currentValue: value,
          enabled: true,
        });
      }
    }

    if (newVars.length > 0) {
      setVariables((prev) => {
        const next = [...prev, ...newVars];
        if (linkedEnvId) syncToSavedEnvironment(next);
        return next;
      });
    }
  };

  const onFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        handleEnvFileContents(content);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        handleEnvFileContents(content);
      }
    };
    reader.readAsText(file);
  };

  const convertToSecret = async (id: string) => {
    if (!auth.currentUser) return;
    const v = variables.find((v) => v.id === id);
    if (!v) return;

    try {
      await DbAPI.saveSecret(auth.currentUser.uid, v.key, {
        value: v.currentValue,
        description: `Secret for ${v.key}`,
      });

      setVariables((prev) => {
        const next: EnvVar[] = prev.map((v) =>
          v.id === id
            ? {
                ...v,
                type: 'secret' as const,
                currentValue: '********',
                initialValue: '********',
              }
            : v,
        );
        if (linkedEnvId) syncToSavedEnvironment(next);
        return next;
      });
    } catch (err) {
      console.error('Failed to save secret:', err);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-surface-elevated text-[var(--foreground)] relative',
        className,
      )}
      onPointerDown={onPointerDown}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-[#1c1c1c]/90 backdrop-blur-sm border-2 border-dashed border-[var(--accent)] flex items-center justify-center rounded-lg m-2">
          <div className="flex flex-col items-center text-[var(--accent)]">
            <Upload className="w-10 h-10 mb-4 opacity-80" />
            <p className="text-sm font-medium">Drop .env file here to upload</p>
          </div>
        </div>
      )}

      <div className="p-4 border-b border-subtle bg-surface/50 space-y-3">
        <div className="relative">
          <select
            value={dropdownEnvId}
            onChange={(e) => handleSelectEnvironment(e.target.value)}
            className="w-full bg-[var(--control-bg)] border border-[var(--border)] rounded-md py-1.5 pl-2.5 pr-8 text-xs text-[var(--foreground)] appearance-none focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] transition-colors"
            disabled={isLoadingEnvs}
          >
            <option value="__create_new__">Create a new environment</option>
            {savedEnvironments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name} ({env.variables?.length || 0} vars)
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
        </div>

        {dropdownEnvId === '__create_new__' && (
          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={!!linkedEnvId}
              onChange={(e) => handleToggleGlobal(e.target.checked)}
              className="w-3.5 h-3.5 rounded bg-[var(--control-bg)] border border-[var(--border)] cursor-pointer accent-blue-500"
            />
            <span className="text-xs text-muted">Save globally</span>
          </label>
        )}
      </div>

      <div className="flex items-center justify-between p-4 border-b border-subtle">
        <div>
          <h3 className="font-medium text-sm flex items-center gap-2">
            Environment Variables
          </h3>
          <p className="text-xs text-muted mt-1">
            Configure environment variables or drag and drop a .env file
            anywhere.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileUpload}
            className="hidden"
            accept=".env,*/*"
          />
          <div className="relative mr-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
            <input
              placeholder="Filter variables"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-background border border-subtle rounded text-xs focus:outline-none focus:border-[var(--accent)] w-64"
            />
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-3 py-1.5 bg-surface border border-subtle rounded text-xs hover:bg-surface-hover"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload .env
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#1c1c1c] p-4">
        <VariablesTable
          variables={filteredVariables}
          onUpdateVar={updateVar}
          onRemoveVar={removeVar}
          onToggleEnabled={toggleEnabled}
          onConvertToSecret={convertToSecret}
        />
      </div>
    </div>
  );
};
