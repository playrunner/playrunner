import React, { useState, useEffect } from "react";
import { Plus, Trash2, MoreHorizontal, Loader2 } from "lucide-react";
import { Button, Input, Badge } from "../components/ui";
import { Modal } from "../components/ui/Modal";
import { auth } from "../lib/firebase";
import { DbAPI } from "../lib/db";
import type { SavedEnvironment, EnvVar } from "../integrations/environment/types";
import { VariablesTable } from "../integrations/environment/VariablesTable";

export default function Environments() {
  const [environments, setEnvironments] = useState<SavedEnvironment[]>([]);
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingEnv, setEditingEnv] = useState<SavedEnvironment | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const loadEnvironments = async (userId: string) => {
    try {
      const envs = await DbAPI.getEnvironments(userId);
      setEnvironments(envs);

      const workflows = await DbAPI.getWorkflows(userId);
      const counts: Record<string, number> = {};
      for (const env of envs) {
        counts[env.id] = 0;
      }
      for (const wf of workflows) {
        if (wf.nodes && Array.isArray(wf.nodes)) {
          for (const node of wf.nodes) {
            if (node.nodeType === "environment" && node.config?.environmentId) {
              if (counts[node.config.environmentId] !== undefined) {
                counts[node.config.environmentId]++;
              }
            }
          }
        }
      }
      setUsageCounts(counts);
    } catch (error) {
      console.error("Error loading environments:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setIsLoading(true);
        await loadEnvironments(user.uid);
      } else {
        setEnvironments([]);
        setUsageCounts({});
        setIsLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleCreate = () => {
    setEditingEnv(null);
    setIsCreateModalOpen(true);
  };

  const handleSave = async (env: SavedEnvironment) => {
    if (!auth.currentUser) return;
    
    // Check for uniqueness
    const existing = environments.find(e => e.name.toLowerCase() === env.name.toLowerCase() && e.id !== env.id);
    if (existing) {
      alert(`An environment with the name "${env.name}" already exists. Please choose a unique name.`);
      return;
    }
    
    setIsSaving(true);
    try {
      const envId = env.id || Date.now().toString(36);
      await DbAPI.saveEnvironment(auth.currentUser.uid, envId, {
        name: env.name,
        description: env.description || "",
        variables: env.variables || [],
        createdAt: env.createdAt || new Date().toISOString(),
      });
      await loadEnvironments(auth.currentUser.uid);
      setIsCreateModalOpen(false);
      setEditingEnv(null);
    } catch (error) {
      console.error("Error saving environment:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, envId: string) => {
    e.stopPropagation();
    if (!auth.currentUser) return;
    if (confirm("Are you sure you want to delete this environment? This will not affect nodes that already have variables loaded.")) {
      try {
        await DbAPI.deleteEnvironment(auth.currentUser.uid, envId);
        await loadEnvironments(auth.currentUser.uid);
      } catch (error) {
        console.error("Error deleting environment:", error);
      }
    }
    setOpenMenuId(null);
  };

  return (
    <>
        <main className="flex-1 overflow-y-auto max-w-6xl mx-auto p-8 w-full">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Environments</h2>
              <p className="text-muted mt-1">Manage reusable environment variable collections for your workflows.</p>
            </div>
            <Button variant="primary" onClick={handleCreate}>
              <Plus className="w-4 h-4 mr-2" />
              New Environment
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted" />
            </div>
          ) : environments.length === 0 ? (
            <div className="bg-surface border border-subtle rounded-xl p-12 text-center text-muted">
              <p className="mb-2">No environments configured yet.</p>
              <p className="text-sm">Create one to share environment variables across your workflow nodes.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {environments.map(env => (
                <div
                  key={env.id}
                  onClick={() => {
                    setEditingEnv(env);
                    setIsCreateModalOpen(true);
                  }}
                  className="group bg-surface border border-subtle rounded-xl p-6 cursor-pointer hover:border-strong transition-colors shadow-sm hover:shadow-md"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center">
                      <span className="text-[var(--foreground)] font-semibold text-sm">
                        {env.name.substring(0, 2).toUpperCase()}
                      </span>
                    </div>

                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === env.id ? null : env.id); }}
                        className="p-1 text-muted hover:text-[var(--foreground)] rounded-md hover:bg-surface transition-colors"
                      >
                        <MoreHorizontal className="w-5 h-5" />
                      </button>

                      {openMenuId === env.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); }} />
                          <div className="absolute right-0 mt-1 w-36 bg-surface border border-subtle rounded-lg shadow-lg z-20 py-1 overflow-hidden">
                            <button
                              onClick={(e) => handleDelete(e, env.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <h3 className="text-lg font-medium text-[var(--foreground)] mb-1 group-hover:text-[var(--foreground)] transition-colors">
                    {env.name}
                  </h3>
                  {env.description && (
                    <p className="text-sm text-muted mb-3 line-clamp-2">{env.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <Badge variant="outline">
                      {env.variables?.length || 0} variable{(env.variables?.length || 0) !== 1 ? "s" : ""}
                    </Badge>
                    {usageCounts[env.id] > 0 && (
                      <Badge variant="outline">
                        Used in {usageCounts[env.id]} workflow{usageCounts[env.id] !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-3">
                    {env.updatedAt ? `Last edited ${new Date(env.updatedAt).toLocaleDateString()}` : "No date"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </main>

      <EnvironmentEditModal
        isOpen={isCreateModalOpen}
        environment={editingEnv}
        onSave={handleSave}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingEnv(null);
        }}
        isSaving={isSaving}
      />
    </>
  );
}

function EnvironmentEditModal({
  isOpen,
  environment,
  onSave,
  onClose,
  isSaving,
}: {
  isOpen: boolean;
  environment: SavedEnvironment | null;
  onSave: (env: SavedEnvironment) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [variables, setVariables] = useState<EnvVar[]>([]);

  useEffect(() => {
    if (isOpen) {
      if (environment) {
        setName(environment.name || "");
        setDescription(environment.description || "");
        setVariables(
          (environment.variables || []).map((v) => ({
            ...v,
            enabled: v.enabled !== undefined ? v.enabled : true,
          }))
        );
      } else {
        setName("");
        setDescription("");
        setVariables([emptyVar()]);
      }
    }
  }, [isOpen, environment]);

  const emptyVar = (): EnvVar => ({
    id: Math.random().toString(36).substring(7),
    key: "",
    type: "default",
    initialValue: "",
    currentValue: "",
    enabled: true,
  });

  useEffect(() => {
    const last = variables[variables.length - 1];
    if (last && (last.key || last.initialValue || last.currentValue)) {
      setVariables((prev) => [...prev, emptyVar()]);
    }
  }, [variables]);

  const updateVar = (id: string, updates: Partial<EnvVar>) => {
    setVariables((prev) => prev.map((v) => (v.id === id ? { ...v, ...updates } : v)));
  };

  const removeVar = (id: string) => {
    setVariables((prev) => prev.filter((v) => v.id !== id));
  };

  const toggleEnabled = (id: string) => {
    setVariables((prev) => prev.map((v) => (v.id === id ? { ...v, enabled: !v.enabled } : v)));
  };

  const validVars = variables.filter((v) => v.key || v.initialValue || v.currentValue);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    onSave({
      id: environment?.id || "",
      userId: "",
      name: trimmedName,
      description: description.trim() || undefined,
      variables: validVars.map((v) => ({
        ...v,
        id: v.id || Math.random().toString(36).substring(7),
      })),
      createdAt: environment?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={environment ? "Edit Environment" : "New Environment"}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production, Staging, QA..."
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Variables</label>
            <span className="text-[10px] text-muted">{validVars.length} defined</span>
          </div>
          <VariablesTable
            variables={variables}
            onUpdateVar={updateVar}
            onRemoveVar={removeVar}
            onToggleEnabled={toggleEnabled}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-subtle">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={isSaving || !name.trim()}>
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {isSaving ? "Saving..." : environment ? "Save Changes" : "Create Environment"}
        </Button>
      </div>
    </Modal>
  );
}
