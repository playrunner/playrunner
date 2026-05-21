import React, { useEffect, useState } from "react";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { Input } from "../../components/ui/Input";
import { auth } from "../../lib/firebase";

export const JiraConfigPanel: React.FC<{
  config: Record<string, any>;
  onChange: (nodeId: string, newConfig: Record<string, any>) => void;
  nodeId: string;
  isConnected: boolean;
  integrationData?: any;
}> = ({ config, onChange, nodeId, isConnected, integrationData }) => {
  const [projects, setProjects] = useState<any[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  useEffect(() => {
    async function fetchProjects() {
      if (!integrationData?.accessToken) return;
      setIsLoadingProjects(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const res = await fetch("/api/jira/projects", {
          headers: {
            "x-jira-auth": integrationData.accessToken,
            "Authorization": `Bearer ${token}`
          }
        });
        const data = await res.json();
        
        if (data.cloudId && data.projects) {
          onChange(nodeId, { ...config, cloudId: data.cloudId });
          setProjects(data.projects);
        }
      } catch (err) {
        console.error("Failed to fetch Jira projects:", err);
      } finally {
        setIsLoadingProjects(false);
      }
    }
    fetchProjects();
  }, [integrationData?.accessToken]);

  const selectedProject = projects.find(p => p.id === config.projectId);
  const issueTypes = selectedProject?.issueTypes || [];

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted">Action</label>
        <Select 
          value={config.action || "create"}
          onChange={(e) => onChange(nodeId, { ...config, action: e.target.value })}
        >
          <option value="create">Create Issue</option>
          <option value="update">Update Issue</option>
        </Select>
      </div>

      {config.action === "update" ? (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted">Issue Key</label>
          <Input 
            value={config.issueKey || ""}
            onChange={(e) => onChange(nodeId, { ...config, issueKey: e.target.value })}
            placeholder="PROJ-123 or {{trigger.issueKey}}"
          />
          <p className="text-[10px] text-muted">The Jira issue key to update.</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">Project</label>
            <Select 
              value={config.projectId || ""}
              onChange={(e) => onChange(nodeId, { ...config, projectId: e.target.value })}
              disabled={isLoadingProjects || !isConnected}
            >
              <option value="">{isLoadingProjects ? "Loading projects..." : "Select Project"}</option>
              {projects.map(proj => (
                <option key={proj.id} value={proj.id}>{proj.name} ({proj.key})</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">Issue Type</label>
            <Select 
              value={config.issueType || ""}
              onChange={(e) => onChange(nodeId, { ...config, issueType: e.target.value })}
              disabled={!config.projectId || issueTypes.length === 0}
            >
              <option value="">{config.projectId ? "Select Issue Type" : "Select a project first"}</option>
              {issueTypes.map((it: any) => (
                <option key={it.id} value={it.name}>{it.name}</option>
              ))}
            </Select>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted">Summary</label>
        <Input 
          value={config.summary || ""}
          onChange={(e) => onChange(nodeId, { ...config, summary: e.target.value })}
          placeholder="Summary of the issue..."
        />
        <p className="text-[10px] text-muted">You can use {"{{variables}}"} here.</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted">Description</label>
        <Textarea 
          value={config.description || ""}
          onChange={(e) => onChange(nodeId, { ...config, description: e.target.value })}
          placeholder="Detailed description..."
          className="min-h-[120px]"
        />
        <p className="text-[10px] text-muted">You can use {"{{variables}}"} here.</p>
      </div>
    </div>
  );
};
