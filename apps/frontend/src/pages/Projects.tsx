import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { auth } from '../lib/auth';
import { DbAPI } from '../lib/db';
import {
  CLOUD_PROVIDERS,
  getDefaultWorkflowCloudProviderId,
} from '../runtime/cloudProviders';
import { PremiumOnboardingModal } from '../runtime/onboarding';

export default function Projects() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const projs = await DbAPI.getProjects(user.uid);
          setProjects(projs);

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
      }
    });

    return () => unsubscribe();
  }, []);

  const handleOnboardingComplete = async (nodes: any[], connections: any[]) => {
    localStorage.setItem('hasCompletedOnboarding', 'true');
    setShowOnboarding(false);

    if (auth.currentUser) {
      const projectId = await DbAPI.createProject(auth.currentUser.uid, {
        title: 'New Project',
      });
      await DbAPI.createWorkflow(auth.currentUser.uid, {
        projectId,
        nodes,
        connections,
        title: 'Default Workflow',
        cloudProvider: getDefaultWorkflowCloudProviderId(),
      });
      navigate(`/projects/${projectId}`);
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

  const handleCreateProject = async () => {
    if (!auth.currentUser || isCreating) return;
    setIsCreating(true);
    try {
      const defaultNodes = [
        {
          id: `env-${Date.now()}`,
          nodeType: 'environment',
          label: 'Environment',
          x: 200,
          y: 300,
          width: 128,
          height: 128,
        },
        {
          id: `playwright-${Date.now()}`,
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
          sourceId: defaultNodes[0].id,
          targetId: defaultNodes[1].id,
          sourcePort: 'right',
          targetPort: 'left',
        },
      ];

      const projectId = await DbAPI.createProject(auth.currentUser.uid, {
        title: 'New Project',
      });
      await DbAPI.createWorkflow(auth.currentUser.uid, {
        projectId,
        nodes: defaultNodes,
        connections: defaultConnections,
        title: 'Default Workflow',
        cloudProvider: getDefaultWorkflowCloudProviderId(),
      });
      navigate(`/projects/${projectId}`);
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setIsCreating(false);
    }
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
            onClick={handleCreateProject}
            disabled={isCreating}
          >
            {isCreating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {isCreating ? 'Creating...' : 'New Project'}
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
                onClick={handleCreateProject}
                disabled={isCreating}
              >
                {isCreating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {isCreating ? 'Creating...' : 'New Project'}
              </Button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
