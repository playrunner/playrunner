import React, { useCallback, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  GitMerge,
  Settings,
  Loader2,
  Plus,
  Cloud,
  Trash2,
  MoreHorizontal,
  Monitor,
  Pencil,
} from 'lucide-react';
import { Button, Badge, Input } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ProjectSettingsModal } from '../components/ProjectSettingsModal';
import { useHeader } from '../components/PageLayout';
import { auth } from '../lib/auth';
import { DbAPI } from '../lib/db';
import {
  getCloudProvider,
  getDefaultWorkflowCloudProviderId,
} from '../runtime/cloudProviders';

const getProviderIcon = (provider?: string) => {
  const p = provider?.toUpperCase();
  if (p === 'LOCAL_RUNNER') return <Monitor className="w-5 h-5 text-muted" />;
  const matchedProvider = getCloudProvider(p || '');
  if (matchedProvider?.icon) {
    return (
      <img
        src={matchedProvider.icon}
        alt={matchedProvider.label}
        className="w-5 h-5 object-contain"
      />
    );
  }
  return <Cloud className="w-5 h-5 text-muted" />;
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [workflowToRename, setWorkflowToRename] = useState<any>(null);
  const [workflowTitle, setWorkflowTitle] = useState('');
  const [isRenamingWorkflow, setIsRenamingWorkflow] = useState(false);

  const { setHeaderLeft } = useHeader();
  const handleSaveTitle = useCallback(async () => {
    setIsEditingTitle(false);
    if (!auth.currentUser || !project || !editedTitle.trim()) {
      setEditedTitle(project?.title || 'Untitled Project');
      return;
    }

    if (editedTitle.trim() !== project.title) {
      try {
        await DbAPI.saveProject(auth.currentUser.uid, project.id, {
          title: editedTitle.trim(),
        });
        setProject((prev: any) => ({ ...prev, title: editedTitle.trim() }));
      } catch (err) {
        console.error('Failed to update project title:', err);
      }
    }
  }, [editedTitle, project]);

  const handleSaveProjectSettings = async (title: string) => {
    if (!auth.currentUser || !project) return;
    await DbAPI.saveProject(auth.currentUser.uid, project.id, { title });
    setProject((previous: any) => ({ ...previous, title }));
    setEditedTitle(title);
  };

  const handleRenameWorkflow = async () => {
    if (
      !auth.currentUser ||
      !workflowToRename ||
      !workflowTitle.trim() ||
      isRenamingWorkflow
    ) {
      return;
    }

    setIsRenamingWorkflow(true);
    try {
      const title = workflowTitle.trim();
      await DbAPI.saveWorkflow(auth.currentUser.uid, workflowToRename.id, {
        title,
      });
      setWorkflows((previous) =>
        previous.map((workflow) =>
          workflow.id === workflowToRename.id
            ? { ...workflow, title }
            : workflow,
        ),
      );
      setWorkflowToRename(null);
    } catch (error) {
      console.error('Failed to rename workflow:', error);
    } finally {
      setIsRenamingWorkflow(false);
    }
  };

  useEffect(() => {
    setHeaderLeft(
      <>
        <button
          onClick={() => navigate('/projects')}
          className="p-2 -ml-2 text-muted hover:text-[var(--foreground)] hover:bg-surface-hover rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="h-6 w-px bg-subtle mx-2" />
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center shrink-0">
            <span className="text-[var(--foreground)] font-semibold text-xs">
              {project?.title
                ? project.title.substring(0, 2).toUpperCase()
                : 'P'}
            </span>
          </div>
          {isEditingTitle ? (
            <input
              autoFocus
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') {
                  setIsEditingTitle(false);
                  setEditedTitle(project?.title || 'Untitled Project');
                }
              }}
              className="text-sm font-semibold bg-transparent border-b border-strong outline-none text-[var(--foreground)] px-1 py-0.5 min-w-[200px]"
            />
          ) : (
            <div className="flex items-center gap-1">
              <h1
                className="text-sm font-semibold text-[var(--foreground)] cursor-text hover:opacity-80 transition-opacity"
                onDoubleClick={() => setIsEditingTitle(true)}
                title="Double-click to edit"
              >
                {project?.title || 'Untitled Project'}
              </h1>
              <button
                type="button"
                onClick={() => setIsEditingTitle(true)}
                className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-[var(--foreground)]"
                aria-label="Rename project"
                title="Rename project"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </>,
    );
    return () => setHeaderLeft(null);
  }, [
    editedTitle,
    handleSaveTitle,
    isEditingTitle,
    navigate,
    project?.title,
    setHeaderLeft,
  ]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user && id) {
        try {
          const proj = await DbAPI.getProject(user.uid, id);
          if (proj) {
            setProject({ ...proj, id });
            setEditedTitle(proj.title || 'Untitled Project');
            const wfs = await DbAPI.getWorkflowsByProject(user.uid, id);
            setWorkflows(wfs);
          } else {
            navigate('/projects');
          }
        } catch (error) {
          console.error('Error fetching project:', error);
        } finally {
          setIsLoading(false);
        }
      } else {
        navigate('/login');
      }
    });

    return () => unsubscribe();
  }, [id, navigate]);

  const handleCreateWorkflow = async () => {
    if (!auth.currentUser || !project || isCreatingWorkflow) return;
    setIsCreatingWorkflow(true);
    try {
      const envId = `env-${Date.now()}`;
      const pwId = `playwright-${Date.now()}`;
      const defaultNodes = [
        {
          id: envId,
          nodeType: 'environment',
          label: 'Environment',
          x: 200,
          y: 300,
          width: 128,
          height: 128,
        },
        {
          id: pwId,
          nodeType: 'playwright',
          label: 'Playwright',
          x: 500,
          y: 300,
          width: 128,
          height: 128,
        },
      ];
      const defaultConnections = [
        {
          id: `conn-${Date.now()}`,
          sourceId: envId,
          targetId: pwId,
          sourcePort: 'right',
          targetPort: 'left',
        },
      ];
      const newId = await DbAPI.createWorkflow(auth.currentUser.uid, {
        projectId: project.id,
        nodes: defaultNodes,
        connections: defaultConnections,
        title: 'New Workflow',
        cloudProvider: getDefaultWorkflowCloudProviderId(),
      });
      navigate(`/workflow/${newId}`);
    } catch (error) {
      console.error('Error creating workflow:', error);
      setIsCreatingWorkflow(false);
    }
  };

  const handleDeleteWorkflow = async (
    e: React.MouseEvent,
    workflowId: string,
  ) => {
    e.stopPropagation();
    setOpenMenuId(null);
    if (!auth.currentUser) return;
    if (confirm('Are you sure you want to delete this workflow?')) {
      try {
        await DbAPI.deleteWorkflow(auth.currentUser.uid, workflowId);
        setWorkflows((prev) => prev.filter((w) => w.id !== workflowId));
      } catch (err) {
        console.error('Failed to delete workflow:', err);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted" />
      </div>
    );
  }

  if (!project) return null;

  return (
    <>
      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold text-[var(--foreground)] mb-2">
              Project Dashboard
            </h2>
            <p className="text-sm text-muted">
              Manage all parts of your project from here.
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Settings className="w-4 h-4" />
              Settings
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="col-span-1 md:col-span-2 mb-2 mt-4 flex justify-between items-center">
            <h3 className="text-xl font-semibold text-[var(--foreground)]">
              Workflows
            </h3>
            <Button
              variant="secondary"
              className="gap-2"
              onClick={handleCreateWorkflow}
              disabled={isCreatingWorkflow}
            >
              {isCreatingWorkflow ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {isCreatingWorkflow ? 'Creating...' : 'New Workflow'}
            </Button>
          </div>

          {workflows.map((wf) => (
            <div
              key={wf.id}
              onClick={() => navigate(`/workflow/${wf.id}`)}
              className="group bg-surface border border-subtle rounded-xl p-6 cursor-pointer hover:border-strong transition-colors shadow-sm hover:shadow-md col-span-1"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center">
                    <GitMerge className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-medium text-[var(--foreground)]">
                    {wf.title || 'Untitled Workflow'}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center justify-center w-8 h-8 bg-[var(--surface-hover)] rounded-md border border-subtle"
                    title={`Provider: ${wf.cloudProvider || 'None'}`}
                  >
                    {getProviderIcon(wf.cloudProvider)}
                  </div>
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === wf.id ? null : wf.id);
                      }}
                      className="p-1.5 text-muted hover:text-[var(--foreground)] rounded-md hover:bg-surface transition-colors"
                      title="More options"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>

                    {openMenuId === wf.id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                          }}
                        />
                        <div className="absolute right-0 mt-1 w-36 bg-surface border border-subtle rounded-lg shadow-lg z-20 py-1 overflow-hidden">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenMenuId(null);
                              setWorkflowToRename(wf);
                              setWorkflowTitle(wf.title || 'Untitled Workflow');
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-[var(--foreground)] hover:bg-surface-hover transition-colors text-left"
                          >
                            <Pencil className="w-4 h-4" />
                            Rename
                          </button>
                          <button
                            onClick={(e) => handleDeleteWorkflow(e, wf.id)}
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
              </div>
              <p className="text-sm text-muted mb-6">
                Design and configure your automated CI/CD and testing pipelines.
              </p>
              <div className="flex items-center justify-between border-t border-subtle pt-4 mt-auto">
                <div className="flex gap-2">
                  <Badge variant="outline">{wf.nodes?.length || 0} Nodes</Badge>
                  <Badge variant="outline">
                    {wf.connections?.length || 0} Conns
                  </Badge>
                </div>
                <ArrowLeft className="w-4 h-4 text-muted rotate-180 group-hover:text-[var(--foreground)] group-hover:translate-x-1 transition-all" />
              </div>
            </div>
          ))}

          {workflows.length === 0 && (
            <div className="col-span-1 md:col-span-2 py-12 text-center border border-dashed border-subtle rounded-xl">
              <p className="text-muted mb-4">
                No workflows found. Create one to get started.
              </p>
              <Button
                variant="primary"
                className="gap-2"
                onClick={handleCreateWorkflow}
                disabled={isCreatingWorkflow}
              >
                {isCreatingWorkflow ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {isCreatingWorkflow ? 'Creating...' : 'New Workflow'}
              </Button>
            </div>
          )}
        </div>
      </main>
      <ProjectSettingsModal
        isOpen={isSettingsOpen}
        projectTitle={project.title || 'Untitled Project'}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveProjectSettings}
      />
      <Modal
        isOpen={Boolean(workflowToRename)}
        onClose={() => setWorkflowToRename(null)}
        title="Rename workflow"
        subtitle="Choose a clear name for this workflow."
        icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setWorkflowToRename(null)}
              disabled={isRenamingWorkflow}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleRenameWorkflow}
              disabled={!workflowTitle.trim() || isRenamingWorkflow}
            >
              {isRenamingWorkflow ? 'Saving…' : 'Rename workflow'}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label
            htmlFor="workflow-title"
            className="block text-sm font-medium text-[var(--foreground)]"
          >
            Workflow name
          </label>
          <Input
            id="workflow-title"
            autoFocus
            value={workflowTitle}
            onChange={(event) => setWorkflowTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleRenameWorkflow();
            }}
          />
        </div>
      </Modal>
    </>
  );
}
