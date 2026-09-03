import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, Plus, Search, MoreHorizontal, Trash2 } from 'lucide-react';
import { Badge, Button, Input } from '../components/ui';
import { ProjectSettingsModal } from '../components/ProjectSettingsModal';
import { NODE_TYPES } from '../components/NodeSelectorModal';
import { auth } from '../lib/auth';
import { DbAPI } from '../lib/db';
import {
  createStarterWorkflow,
  DEFAULT_PROJECT_NODE_TYPES,
} from '../lib/projectDefaults';
import {
  CLOUD_PROVIDERS,
  getDefaultWorkflowCloudProviderId,
} from '../runtime/cloudProviders';
import { PremiumOnboardingModal } from '../runtime/onboarding';

const AVAILABLE_STARTING_NODE_TYPES = NODE_TYPES.filter(
  (nodeType) => nodeType.executionRole === 'workflow',
).sort((left, right) => {
  const leftOrder = left.nodeSelectorOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.nodeSelectorOrder ?? Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || left.label.localeCompare(right.label);
});

export default function Projects() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [sharedWorkflows, setSharedWorkflows] = useState<any[]>([]);
  const [starterWorkflow, setStarterWorkflow] = useState<{
    nodes: any[];
    connections: any[];
    defaultNodeTypes: string[];
  } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const [projs, shared] = await Promise.all([
            DbAPI.getProjects(user.uid),
            DbAPI.getSharedWorkflows(),
          ]);
          setProjects(projs);
          setSharedWorkflows(shared);

          const hasCompleted = localStorage.getItem('hasCompletedOnboarding');
          const credentialProviders = CLOUD_PROVIDERS.filter(
            (provider) => provider.credentialId,
          );
          if (
            !hasCompleted &&
            PremiumOnboardingModal &&
            credentialProviders.length > 0
          ) {
            const connected = await Promise.all(
              credentialProviders.map((provider) =>
                DbAPI.getCloudCredential(user.uid, provider.credentialId!),
              ),
            );
            if (
              connected.some(
                (connection) => connection?.credentialStatus?.configured,
              )
            ) {
              localStorage.setItem('hasCompletedOnboarding', 'true');
              setShowOnboarding(false);
            } else {
              setShowOnboarding(true);
            }
          }
        } catch (error) {
          console.error('Error fetching project data:', error);
        }
      } else {
        const hasCompleted = localStorage.getItem('hasCompletedOnboarding');
        if (!hasCompleted && PremiumOnboardingModal) setShowOnboarding(true);
        setProjects([]);
        setSharedWorkflows([]);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleOnboardingComplete = async (nodes: any[], connections: any[]) => {
    localStorage.setItem('hasCompletedOnboarding', 'true');
    setShowOnboarding(false);

    if (auth.currentUser) {
      setStarterWorkflow({
        nodes,
        connections,
        defaultNodeTypes: nodes
          .map((node) => node.nodeType)
          .filter(
            (nodeType): nodeType is string => typeof nodeType === 'string',
          ),
      });
      setShowCreateProject(true);
    } else {
      navigate('/workflow', {
        state: { initialNodes: nodes, initialConnections: connections },
      });
    }
  };

  const handleOnboardingSkip = () => {
    localStorage.setItem('hasCompletedOnboarding', 'true');
    setShowOnboarding(false);
  };

  const openCreateProject = () => {
    const { nodes, connections } = createStarterWorkflow(
      DEFAULT_PROJECT_NODE_TYPES,
      NODE_TYPES,
    );
    setStarterWorkflow({
      nodes,
      connections,
      defaultNodeTypes: DEFAULT_PROJECT_NODE_TYPES,
    });
    setShowCreateProject(true);
  };

  const handleCreateProject = async (settings: {
    title: string;
    defaultNodeTypes: string[];
  }) => {
    if (!auth.currentUser || !starterWorkflow) {
      throw new Error('A signed-in user and starter workflow are required.');
    }

    const hasChangedStartingNodes =
      settings.defaultNodeTypes.length !==
        starterWorkflow.defaultNodeTypes.length ||
      settings.defaultNodeTypes.some(
        (nodeType, index) =>
          nodeType !== starterWorkflow.defaultNodeTypes[index],
      );
    const workflow = hasChangedStartingNodes
      ? createStarterWorkflow(
          settings.defaultNodeTypes,
          AVAILABLE_STARTING_NODE_TYPES,
        )
      : starterWorkflow;
    const projectId = await DbAPI.createProject(auth.currentUser.uid, {
      ...settings,
    });
    try {
      await DbAPI.createWorkflow(auth.currentUser.uid, {
        projectId,
        nodes: workflow.nodes,
        connections: workflow.connections,
        title: settings.title,
        cloudProvider: getDefaultWorkflowCloudProviderId(),
      });
    } catch (error) {
      await DbAPI.deleteProject(auth.currentUser.uid, projectId).catch(
        (cleanupError) => {
          console.error('Failed to clean up incomplete project:', cleanupError);
        },
      );
      throw error;
    }
    setShowCreateProject(false);
    navigate(`/projects/${projectId}`);
  };

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!auth.currentUser) return;
    if (confirm('Are you sure you want to delete this project?')) {
      try {
        await DbAPI.deleteProject(auth.currentUser.uid, id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } catch (err) {
        console.error('Failed to delete project:', err);
      }
    }
    setOpenMenuId(null);
  };

  return (
    <>
      {PremiumOnboardingModal ? (
        <PremiumOnboardingModal
          isOpen={showOnboarding}
          onComplete={handleOnboardingComplete}
          onSkip={handleOnboardingSkip}
        />
      ) : null}

      <ProjectSettingsModal
        mode="create"
        isOpen={showCreateProject}
        projectTitle="New Project"
        defaultNodeTypes={
          starterWorkflow?.defaultNodeTypes ?? DEFAULT_PROJECT_NODE_TYPES
        }
        availableNodeTypes={AVAILABLE_STARTING_NODE_TYPES}
        onClose={() => setShowCreateProject(false)}
        onSave={handleCreateProject}
      />

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div className="relative w-64">
            <Input
              placeholder="Search projects..."
              icon={<Search className="w-4 h-4" />}
            />
          </div>
          <Button
            variant="primary"
            className="gap-2"
            onClick={openCreateProject}
          >
            <Plus className="w-4 h-4" />
            New Project
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((proj) => (
            <div
              key={proj.id}
              onClick={() => navigate(`/projects/${proj.id}`)}
              className="group bg-surface border border-subtle rounded-xl p-6 cursor-pointer hover:border-strong transition-colors shadow-sm hover:shadow-md"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-lg bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center">
                  <span className="text-[var(--foreground)] font-semibold">
                    {proj.title
                      ? proj.title.substring(0, 2).toUpperCase()
                      : 'P'}
                  </span>
                </div>

                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === proj.id ? null : proj.id);
                    }}
                    className="p-1 text-muted hover:text-[var(--foreground)] rounded-md hover:bg-surface transition-colors"
                  >
                    <MoreHorizontal className="w-5 h-5" />
                  </button>

                  {openMenuId === proj.id && (
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
                          onClick={(e) => handleDeleteProject(e, proj.id)}
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
                {proj.title || 'Untitled Project'}
              </h3>
              <p className="text-sm text-muted mb-4">
                {proj.updatedAt
                  ? `Last edited ${new Date(proj.updatedAt).toLocaleDateString()}`
                  : 'No date'}
              </p>
            </div>
          ))}

          {projects.length === 0 && (
            <div className="col-span-full py-12 text-center border border-dashed border-subtle rounded-xl">
              <p className="text-muted mb-4">
                No projects found. Create one to get started.
              </p>
              <Button
                variant="primary"
                className="gap-2"
                onClick={openCreateProject}
              >
                <Plus className="w-4 h-4" />
                New Project
              </Button>
            </div>
          )}
        </div>

        {sharedWorkflows.length > 0 ? (
          <section className="mt-10 border-t border-subtle pt-8">
            <div className="mb-5">
              <h2 className="text-xl font-medium text-[var(--foreground)]">
                Shared with your teams
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                These workflows are read-only in the editor and use the
                owner&apos;s linked environments and connections when run.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sharedWorkflows.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  className="rounded-xl border border-subtle bg-surface p-5 text-left shadow-sm transition-colors hover:border-strong"
                  onClick={() => navigate(`/workflow/${workflow.id}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-subtle bg-surface-hover">
                        <GitBranch className="h-4 w-4 text-muted" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-[var(--foreground)]">
                          {workflow.title || 'Untitled Workflow'}
                        </h3>
                        <p className="mt-1 truncate text-xs text-muted">
                          {workflow.access.sharedTeams
                            .map((team: { name: string }) => team.name)
                            .join(', ')}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">View &amp; run</Badge>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
