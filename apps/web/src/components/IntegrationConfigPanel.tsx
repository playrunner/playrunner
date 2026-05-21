import React, { useEffect, useState, useRef } from "react";
import { cn } from "../lib/utils";
import { Input } from "./ui/Input";
import { Textarea } from "./ui/Textarea";
import { Select } from "./ui/Select";
import { auth } from "../lib/firebase";
import { DbAPI } from "../lib/db";
import { INTEGRATIONS } from "../integrations/registry";
import { ChevronDown, ChevronUp, Info, Eye, EyeOff } from "lucide-react";

interface IntegrationConfigPanelProps {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  config: Record<string, any>;
  onChange: (nodeId: string, newConfig: Record<string, any>) => void;
  className?: string;
  onPointerDown?: (e: React.PointerEvent) => void;
  onConnectOAuth?: (providerId?: string) => void;
  incomingNodes?: any[];
  onLabelChange?: (nodeId: string, newLabel: string) => void;
}

export const IntegrationConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  nodeId,
  nodeLabel,
  nodeType,
  config,
  onChange,
  className,
  onPointerDown,
  onConnectOAuth,
  incomingNodes = [],
  onLabelChange
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [integrationData, setIntegrationData] = useState<any>(null);
  const [collapsedInputs, setCollapsedInputs] = useState<Record<string, boolean>>({});
  const [expandedMediaItems, setExpandedMediaItems] = useState<Record<string, boolean>>({});

  const [leftWidth, setLeftWidth] = useState(33.33);
  const [rightWidth, setRightWidth] = useState(33.33);
  const containerRef = useRef<HTMLDivElement>(null);

  const startResize = (e: React.PointerEvent, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    if (!containerRef.current) return;
    const containerWidth = containerRef.current.getBoundingClientRect().width;
    const startX = e.clientX;
    const startLeft = leftWidth;
    const startRight = rightWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;

      if (side === 'left') {
        const newLeft = Math.min(Math.max(startLeft + deltaPercent, 15), 70);
        if (100 - newLeft - startRight >= 15) setLeftWidth(newLeft);
      } else {
        const newRight = Math.min(Math.max(startRight - deltaPercent, 15), 70);
        if (100 - startLeft - newRight >= 15) setRightWidth(newRight);
      }
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  const currentIntegration = INTEGRATIONS.find(i => i.id === nodeType);

  useEffect(() => {
    if (!auth.currentUser) return;

    let integrationId = config?.authProvider || currentIntegration?.authProviderId || currentIntegration?.id;

    if (!integrationId) {
      if (currentIntegration?.authProviders) {
        // If the node hasn't selected a provider yet, check if one is already connected
        const checkProviders = async () => {
          for (const provider of currentIntegration.authProviders!) {
            try {
              const integration = await DbAPI.getIntegration(auth.currentUser.uid, provider.id);
              if (integration) {
                onChange(nodeId, { ...config, authProvider: provider.id });
                return;
              }
            } catch (e) { }
          }
        };
        checkProviders();
      }
      setIsConnected(false);
      setIntegrationData(null);
      return;
    }

    const unsubscribe = DbAPI.subscribeToIntegration(auth.currentUser.uid, integrationId, (exists, data) => {
      setIsConnected(exists);
      setIntegrationData(data || null);
    });

    return () => unsubscribe();
  }, [nodeType, currentIntegration, config?.authProvider]);

  return (
    <div
      ref={containerRef}
      className={cn("bg-surface border border-strong rounded-xl shadow-xl flex overflow-hidden", className)}
      onPointerDown={onPointerDown}
    >
      {/* Left Column: Input */}
      {nodeType !== "environment" && nodeType !== "schedule" && (
        <>
          <div style={{ width: `${leftWidth}%` }} className="bg-[var(--background)] border-r border-subtle flex flex-col shrink-0 overflow-hidden">
            <div className="h-14 p-4 border-b border-subtle flex items-center justify-between shrink-0">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Input</h3>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-6">
              {incomingNodes && incomingNodes.length > 0 && (
                <div className="bg-[#18181b] border border-subtle text-gray-300 rounded-lg p-3 flex items-start gap-3 shadow-inner">
                  <div className="mt-0.5 text-muted">
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-xs leading-relaxed">
                    Drag any variable to the configuration panel.
                  </p>
                </div>
              )}
              {incomingNodes.length > 0 ? (
                incomingNodes.map(inNode => {
                  const isCollapsed = collapsedInputs[inNode.id];
                  const toggleCollapse = () => setCollapsedInputs(prev => ({ ...prev, [inNode.id]: !prev[inNode.id] }));
                  const nodeTypeKey = (inNode.nodeType || inNode.label).toLowerCase();
                  const matchedIntegration = INTEGRATIONS.find(i => i.id === nodeTypeKey);
                  const NodeIcon = matchedIntegration ? (
                    typeof matchedIntegration.icon === 'string'
                      ? <img src={matchedIntegration.icon} alt={inNode.label} className="w-4 h-4 object-contain" />
                      : <matchedIntegration.icon className={cn("w-4 h-4", matchedIntegration.color)} />
                  ) : null;

                  if (inNode.nodeType === "environment") {
                    const vars = inNode.config?.variables?.filter((v: any) => v.enabled && v.key) || [];
                    if (vars.length === 0) return null;
                    return (
                      <div key={inNode.id} className="space-y-3 border border-subtle rounded-md p-2">
                        <button onClick={toggleCollapse} className="flex items-center justify-between w-full text-left group">
                          <div className="flex items-center gap-2">
                            {NodeIcon}
                            <h4 className="text-xs font-medium text-muted uppercase tracking-wider group-hover:text-[var(--foreground)] transition-colors">{inNode.label}</h4>
                          </div>
                          {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted group-hover:text-[var(--foreground)] transition-colors" /> : <ChevronUp className="w-4 h-4 text-muted group-hover:text-[var(--foreground)] transition-colors" />}
                        </button>
                        {!isCollapsed && (
                          <div className="space-y-2 mt-2">
                            {vars.map((v: any) => (
                              <div
                                key={v.id}
                                className="flex items-center justify-between p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-grab active:cursor-grabbing"
                                draggable
                                onDragStart={(e) => {
                                  const dragText = `process.env.${v.key}`;
                                  e.dataTransfer.setData('text/plain', dragText);

                                  const dragGhost = document.createElement('div');
                                  dragGhost.textContent = dragText;
                                  dragGhost.className = "bg-[#18181b] text-blue-400 px-2 py-1 rounded text-xs font-mono border border-subtle shadow-lg absolute -top-96";
                                  document.body.appendChild(dragGhost);
                                  e.dataTransfer.setDragImage(dragGhost, 10, 10);

                                  setTimeout(() => {
                                    document.body.removeChild(dragGhost);
                                  }, 0);
                                }}
                                title="Drag and drop into the script editor"
                              >
                                <span className="text-xs font-mono text-blue-400">env.{v.key}</span>
                                <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">{v.type === 'secret' ? 'secret' : 'string'}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  } else if (inNode.nodeType === "playwright") {
                    return (
                      <div key={inNode.id} className="space-y-3 border border-subtle rounded-md p-2">
                        <button onClick={toggleCollapse} className="flex items-center justify-between w-full text-left group">
                          <div className="flex items-center gap-2">
                            {NodeIcon}
                            <h4 className="text-xs font-medium text-muted uppercase tracking-wider group-hover:text-[var(--foreground)] transition-colors">{inNode.label}</h4>
                          </div>
                          {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted group-hover:text-[var(--foreground)] transition-colors" /> : <ChevronUp className="w-4 h-4 text-muted group-hover:text-[var(--foreground)] transition-colors" />}
                        </button>
                        {!isCollapsed && (
                          <div className="space-y-2 mt-2">
                            {inNode.output?.reportUrl && (
                              <div
                                className="flex flex-col gap-2 p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-grab active:cursor-grabbing"
                                draggable
                                onDragStart={(e) => {
                                  const dragText = `{{node_${inNode.id}.reportUrl}}`;
                                  e.dataTransfer.setData('text/plain', dragText);

                                  const dragGhost = document.createElement('div');
                                  dragGhost.textContent = dragText;
                                  dragGhost.className = "bg-[#18181b] text-blue-400 px-2 py-1 rounded text-xs font-mono border border-subtle shadow-lg absolute -top-96";
                                  document.body.appendChild(dragGhost);
                                  e.dataTransfer.setDragImage(dragGhost, 10, 10);

                                  setTimeout(() => {
                                    document.body.removeChild(dragGhost);
                                  }, 0);
                                }}
                                title="Drag to inject this value"
                              >
                                <div className="flex items-center justify-between pointer-events-none">
                                  <span className="text-xs font-mono text-blue-400">reportUrl</span>
                                  <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">url</span>
                                </div>
                                <a href={inNode.output.reportUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline break-all pointer-events-auto w-fit" onDragStart={e => e.preventDefault()} onClick={e => e.stopPropagation()}>
                                  Open HTML Report
                                </a>
                              </div>
                            )}
                            {inNode.output?.media && inNode.output.media.length > 0 && (() => {
                              const listKey = `list-${inNode.id}`;
                              const isListExpanded = expandedMediaItems[listKey];
                              return (
                                <>
                                  <div
                                    className="flex items-center justify-between p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-grab active:cursor-grabbing"
                                    draggable
                                    onDragStart={(e) => {
                                      const dragText = `{{node_${inNode.id}.media}}`;
                                      e.dataTransfer.setData('text/plain', dragText);

                                      const dragGhost = document.createElement('div');
                                      dragGhost.textContent = dragText;
                                      dragGhost.className = "bg-[#18181b] text-blue-400 px-2 py-1 rounded text-xs font-mono border border-subtle shadow-lg absolute -top-96";
                                      document.body.appendChild(dragGhost);
                                      e.dataTransfer.setDragImage(dragGhost, 10, 10);

                                      setTimeout(() => {
                                        document.body.removeChild(dragGhost);
                                      }, 0);
                                    }}
                                    title="Drag to inject all media as an array"
                                  >
                                    <div className="flex items-center gap-2 pointer-events-none">
                                      <span className="text-xs font-mono text-purple-400">media</span>
                                      <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">array[{inNode.output.media.length}]</span>
                                    </div>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedMediaItems(prev => ({ ...prev, [listKey]: !prev[listKey] }));
                                      }}
                                      className="text-muted hover:text-[var(--foreground)] transition-colors p-1"
                                      title={isListExpanded ? "Hide media list" : "Show media list"}
                                    >
                                      {isListExpanded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                  </div>
                                  
                                  {isListExpanded && (
                                    <div className="pl-3 mt-2 space-y-2 border-l border-subtle ml-2">
                                      {inNode.output.media.map((mediaUrl: string, idx: number) => {
                                        const isVideo = mediaUrl.endsWith('.webm');
                                        const mediaKey = `${inNode.id}-${idx}`;
                                        const isExpanded = expandedMediaItems[mediaKey];
                                        return (
                                          <div
                                            key={idx}
                                            className="flex flex-col gap-2 p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-grab active:cursor-grabbing"
                                            draggable
                                            onDragStart={(e) => {
                                              const dragText = `{{node_${inNode.id}.media[${idx}]}}`;
                                              e.dataTransfer.setData('text/plain', dragText);

                                              const dragGhost = document.createElement('div');
                                              dragGhost.textContent = dragText;
                                              dragGhost.className = "bg-[#18181b] text-blue-400 px-2 py-1 rounded text-xs font-mono border border-subtle shadow-lg absolute -top-96";
                                              document.body.appendChild(dragGhost);
                                              e.dataTransfer.setDragImage(dragGhost, 10, 10);

                                              setTimeout(() => {
                                                document.body.removeChild(dragGhost);
                                              }, 0);
                                            }}
                                            title="Drag to inject this URL"
                                          >
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-mono text-purple-400 pointer-events-none">media[{idx}]</span>
                                              <div className="flex items-center gap-2">
                                                <button 
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setExpandedMediaItems(prev => ({ ...prev, [mediaKey]: !prev[mediaKey] }));
                                                  }}
                                                  className="text-muted hover:text-[var(--foreground)] transition-colors p-1"
                                                  title={isExpanded ? 'Hide' : 'Show'}
                                                >
                                                  {isExpanded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                                <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5 pointer-events-none">{isVideo ? 'video' : 'image'}</span>
                                              </div>
                                            </div>
                                            {isExpanded && (
                                              isVideo ? (
                                                <video src={mediaUrl} controls className="w-full h-auto rounded border border-subtle pointer-events-auto" onDragStart={e => e.preventDefault()} onClick={e => e.stopPropagation()} />
                                              ) : (
                                                <img src={mediaUrl} alt="artifact" className="w-full h-auto rounded border border-subtle pointer-events-none" />
                                              )
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                            {(!inNode.output?.reportUrl && (!inNode.output?.media || inNode.output.media.length === 0)) && (
                              <div className="p-2 rounded border border-dashed border-subtle bg-surface/50 text-center">
                                <span className="text-xs text-muted">Run node to fetch outputs</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    return (
                      <div key={inNode.id} className="space-y-3 border border-subtle rounded-md p-2">
                        <button onClick={toggleCollapse} className="flex items-center justify-between w-full text-left group">
                          <div className="flex items-center gap-2">
                            {NodeIcon}
                            <h4 className="text-xs font-medium text-muted uppercase tracking-wider group-hover:text-[var(--foreground)] transition-colors">{inNode.label}</h4>
                          </div>
                          {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted group-hover:text-[var(--foreground)] transition-colors" /> : <ChevronUp className="w-4 h-4 text-muted group-hover:text-[var(--foreground)] transition-colors" />}
                        </button>
                        {!isCollapsed && (
                          <div className="space-y-2 mt-2">
                            <div className="flex items-center justify-between p-2 rounded hover:bg-surface transition-colors border border-transparent hover:border-subtle cursor-grab active:cursor-grabbing"
                              draggable
                              onDragStart={(e) => {
                                const dragText = `{{node_${inNode.id}.result.data}}`;
                                e.dataTransfer.setData('text/plain', dragText);

                                const dragGhost = document.createElement('div');
                                dragGhost.textContent = dragText;
                                dragGhost.className = "bg-[#18181b] text-blue-400 px-2 py-1 rounded text-xs font-mono border border-subtle shadow-lg absolute -top-96";
                                document.body.appendChild(dragGhost);
                                e.dataTransfer.setDragImage(dragGhost, 10, 10);

                                setTimeout(() => {
                                  document.body.removeChild(dragGhost);
                                }, 0);
                              }}
                              title="Drag to inject this object"
                            >
                              <span className="text-xs font-mono text-blue-400">result.data</span>
                              <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">object</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                })
              ) : (
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Connected Nodes</h4>
                  <p className="text-sm text-muted">No nodes connected yet.</p>
                </div>
              )}
            </div>
          </div>
          <div
            onPointerDown={(e) => startResize(e, 'left')}
            className="w-1 bg-[var(--border)] hover:bg-blue-500 cursor-col-resize shrink-0 z-10 transition-colors"
          />
        </>
      )}

      {/* Middle Column: Data / Config */}
      <div
        style={{ width: (nodeType === "environment" || nodeType === "schedule") ? `${100 - rightWidth}%` : `${100 - leftWidth - rightWidth}%` }}
        className={cn("flex flex-col overflow-hidden", (nodeType !== "environment" && nodeType !== "schedule") && "bg-surface")}
      >
        <div className="h-14 p-4 border-b border-subtle flex items-center justify-between shrink-0">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Configuration</h3>
        </div>
        <div className="flex-1 overflow-y-auto w-full p-6 space-y-6">
          {(currentIntegration?.requiresAuth !== false && currentIntegration?.id !== 'playwright') && (
            <div className="bg-[var(--background)] border border-subtle rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-subtle pb-2">
                <h4 className="text-sm font-medium text-[var(--foreground)]">Authentication</h4>
                {isConnected ? (
                  <button
                    onClick={() => onConnectOAuth?.()}
                    className="text-xs bg-[var(--control-bg)] hover:bg-[var(--surface-hover)] border border-[var(--border)] px-3 py-1 rounded-md text-[var(--foreground)] transition-colors font-medium"
                  >
                    Configure Connection
                  </button>
                ) : currentIntegration?.authProviders ? (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        onChange(nodeId, { ...config, authProvider: e.target.value });
                        onConnectOAuth?.(e.target.value);
                      }
                      e.target.value = ""; // reset after selection
                    }}
                    className="text-xs bg-[var(--control-bg)] hover:bg-[var(--surface-hover)] border border-[var(--border)] px-2 py-1 rounded-md text-[var(--foreground)] transition-colors font-medium appearance-none focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)]"
                    style={{ paddingRight: '1rem' }}
                  >
                    <option value="" disabled>Connect Provider...</option>
                    {currentIntegration.authProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                ) : currentIntegration?.authProviderId ? (
                  <button
                    onClick={() => onConnectOAuth?.()}
                    className="text-xs bg-[var(--accent)] hover:bg-[var(--accent)]/90 px-3 py-1 rounded-md text-[var(--accent-foreground)] transition-colors font-medium"
                  >
                    Connect {currentIntegration.authProviderId.charAt(0).toUpperCase() + currentIntegration.authProviderId.slice(1)}
                  </button>
                ) : (
                  <button
                    onClick={() => onConnectOAuth?.()}
                    className="text-xs bg-[var(--control-bg)] hover:bg-[var(--surface-hover)] border border-[var(--border)] px-3 py-1 rounded-md text-[var(--foreground)] transition-colors font-medium"
                  >
                    Connect
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-green-400" : "bg-red-400")}></div>
                  <span className="text-sm text-[var(--foreground)]">
                    {isConnected
                      ? (currentIntegration?.authProviderId ? `Connected (${currentIntegration.authProviderId.charAt(0).toUpperCase() + currentIntegration.authProviderId.slice(1)})` : "Connected")
                      : "Not Connected"}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted">Connect your account to allow this node to perform actions on your behalf.</p>
            </div>
          )}

          {currentIntegration?.ConfigPanel ? (
            <currentIntegration.ConfigPanel
              config={config}
              onChange={onChange}
              nodeId={nodeId}
              nodeLabel={nodeLabel}
              isConnected={isConnected}
              onConnectOAuth={() => onConnectOAuth?.()}
              integrationData={integrationData}
              onLabelChange={(newLabel: string) => onLabelChange?.(nodeId, newLabel)}
            />
          ) : (
            <>
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-[var(--foreground)] border-b border-subtle pb-2">Configuration</h4>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Action</label>
                  <Select>
                    <option>Send a Message</option>
                    <option>Create an Issue</option>
                    <option>Update Status</option>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Target / Channel</label>
                  <Input
                    value={config.channel || ""}
                    onChange={(e) => onChange(nodeId, { ...config, channel: e.target.value })}
                    placeholder="#engineering-alerts"
                    className="bg-[var(--background)] border-subtle"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Message Template</label>
                  <Textarea
                    value={config.message || ""}
                    onChange={(e) => onChange(nodeId, { ...config, message: e.target.value })}
                    placeholder="Build failed: {{error}}"
                    className="min-h-[100px] bg-[var(--background)] border-subtle text-[var(--foreground)]"
                  />
                  <p className="text-[10px] text-muted">Use {"{{variable}}"} syntax to inject data from Input.</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div
        onPointerDown={(e) => startResize(e, 'right')}
        className="w-1 bg-[var(--border)] hover:bg-blue-500 cursor-col-resize shrink-0 z-10 transition-colors"
      />

      {/* Right Column: Output */}
      <div style={{ width: `${rightWidth}%` }} className="bg-[var(--background)] border-l border-subtle flex flex-col shrink-0 overflow-hidden">
        <div className="h-14 p-4 border-b border-subtle flex items-center justify-between shrink-0">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Output</h3>
          <span className="text-[10px] text-muted px-2 py-0.5 rounded-full border border-subtle">Preview</span>
        </div>
        <div className="p-4 flex-1 overflow-y-auto space-y-6">
          {nodeType === "environment" ? (
            <div className="space-y-6">
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Provides</h4>
                <div className="space-y-2">
                  {Array.isArray(config.variables) && config.variables.filter((v: any) => v.enabled && v.key).length > 0 ? (
                    config.variables.filter((v: any) => v.enabled && v.key).map((v: any) => (
                      <div key={v.id} className="flex items-center justify-between p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-default">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-green-400">{v.key}</span>
                        </div>
                        <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">{v.type === 'secret' ? 'secret' : 'string'}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted italic">No variables selected for output.</p>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-subtle">
                <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Usage</h4>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-[var(--foreground)]">Node Inputs</p>
                    <p className="text-[10px] text-muted leading-relaxed">Access directly in any node parameter using the curly brace syntax:</p>
                    <div className="bg-[#18181b] p-2 rounded border border-subtle font-mono text-[10px] text-blue-400 mt-1">
                      {"{ "}env.{config.variables?.[0]?.key || "MY_VAR"}{" }"}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-[var(--foreground)]">Container Runtime</p>
                    <p className="text-[10px] text-muted leading-relaxed">Available as standard environment variables in your runner's shell or code:</p>
                    <div className="bg-[#18181b] p-2 rounded border border-subtle font-mono text-[10px] text-amber-400 mt-1">
                      process.env.{config.variables?.[0]?.key || "MY_VAR"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : nodeType === "playwright" ? (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Provides</h4>
              <div className="space-y-2">
                <div className="flex flex-col gap-1.5 p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-default">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-green-400">output.reportUrl</span>
                    <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">url</span>
                  </div>
                  <span className="text-[10px] text-muted">URL to the Playwright HTML report</span>
                </div>
                <div className="flex flex-col gap-1.5 p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-default">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-green-400">output.media</span>
                    <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">array</span>
                  </div>
                  <span className="text-[10px] text-muted">List of video and screenshot artifact URLs</span>
                </div>
              </div>
            </div>
          ) : nodeType === "schedule" ? (
            <div className="space-y-6">
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Trigger Info</h4>
                <div className="space-y-2">
                  <div className="flex flex-col gap-1.5 p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-default">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-white/80">trigger.type</span>
                      <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">string</span>
                    </div>
                    <span className="text-[10px] text-muted">Always "schedule"</span>
                  </div>
                  <div className="flex flex-col gap-1.5 p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-default">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-white/80">trigger.scheduledAt</span>
                      <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">datetime</span>
                    </div>
                    <span className="text-[10px] text-muted">ISO timestamp of when the trigger fired</span>
                  </div>
                  <div className="flex flex-col gap-1.5 p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-default">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-white/80">trigger.cron</span>
                      <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">string</span>
                    </div>
                    <span className="text-[10px] text-muted">The cron expression for this schedule</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-subtle">
                <h4 className="text-xs font-medium text-muted uppercase tracking-wider">About</h4>
                <p className="text-[10px] text-muted leading-relaxed">
                  This node triggers the workflow on a recurring schedule. It has no connections — simply drop it on the canvas and configure the schedule. When the schedule fires, all workflows containing this node will be executed automatically.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Provides</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-default">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-green-400">result.status</span>
                  </div>
                  <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">string</span>
                </div>
                <div className="flex flex-col gap-1.5 p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-default">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-green-400">result.data</span>
                    <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">object</span>
                  </div>
                  <span className="text-[10px] text-muted">Response payload</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-surface border border-subtle hover:border-strong transition-colors cursor-default">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-orange-400">error.message</span>
                  </div>
                  <span className="text-[10px] text-muted border border-subtle rounded px-1.5 py-0.5">string</span>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-subtle">
            <div className="rounded-lg bg-surface border border-subtle p-3 flex flex-col gap-2">
              <span className="text-xs font-medium text-[var(--foreground)]">Test Execution</span>
              <p className="text-[10px] text-muted">Run this node isolated to fetch real output schema.</p>
              <button className="mt-2 w-full text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-3 py-1.5 rounded-md transition-colors font-medium">
                Test Node
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
