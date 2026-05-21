import React from "react";
import { Textarea } from "../../components/ui/Textarea";

export const JavascriptConfigPanel: React.FC<{
  config: Record<string, any>;
  onChange: (nodeId: string, newConfig: Record<string, any>) => void;
  nodeId: string;
}> = ({ config, onChange, nodeId }) => {
  return (
    <div className="flex flex-col h-[300px] gap-2">
      <label className="text-sm font-medium text-[var(--foreground)]">Script Editor</label>
      <Textarea 
        value={config.code || ""}
        onChange={(e) => onChange(nodeId, { ...config, code: e.target.value })}
        placeholder="return { status: 'success' };"
        className="flex-1 font-mono text-sm placeholder:text-muted text-[var(--foreground)] bg-[var(--background)] border-strong resize-none"
      />
      <p className="text-xs text-muted mt-2">Code runs in a sandboxed environment.</p>
    </div>
  );
};
