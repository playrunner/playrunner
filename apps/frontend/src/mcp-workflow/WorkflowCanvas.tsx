import { workflowNodeAppearance } from '../components/workflow/nodeAppearance';
import { useLayoutEffect, useRef, useState } from 'react';
import { Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ALL_NODE_TYPES } from '../integrations/nodeCatalog';
import { getNodeDimensions } from '../../../runners/shared/workflow-geometry';
import {
  EnvironmentNodeShape,
  WorkflowNodeIcon,
} from '../components/workflow/WorkflowNodeVisual';
import {
  getPortCoordinates,
  getAttachmentPortCoordinates,
  renderCurve,
  type PortPosition,
  type AttachmentKind,
} from '../components/workflow/geometry';

export interface CanvasNode {
  id: string;
  nodeType: string;
  label: string;
  x: number;
  y: number;
}
export interface CanvasConnection {
  id: string;
  sourceId: string;
  targetId: string;
  sourcePort?: PortPosition;
  targetPort?: PortPosition;
  role?: string;
  type?: string;
  attachmentPort?: AttachmentKind;
}
export interface CanvasWorkflow {
  id: string;
  title: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

const portPositions = {
  top: '-top-3 left-1/2 -translate-x-1/2',
  right: '-right-3 top-1/2 -translate-y-1/2',
  bottom: '-bottom-3 left-1/2 -translate-x-1/2',
  left: '-left-3 top-1/2 -translate-y-1/2',
};

export function WorkflowCanvas({
  workflow,
  fitRevision,
  onSelect,
}: {
  workflow: CanvasWorkflow;
  fitRevision: number;
  onSelect: (node: CanvasNode) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [selected, setSelected] = useState<string>();
  const drag = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const currentWorkflow = useRef(workflow);
  currentWorkflow.current = workflow;

  // Refit on graph changes so newly saved nodes remain visible. Keep the saved
  // coordinates and dimensions; only the viewport transform changes.
  useLayoutEffect(() => {
    const fit = () => {
      const el = viewport.current;
      const nodes = currentWorkflow.current.nodes;
      if (!el || !nodes.length) return;
      const minX = Math.min(...nodes.map((n) => n.x)) - 60;
      const minY = Math.min(...nodes.map((n) => n.y)) - 40;
      const maxX =
        Math.max(...nodes.map((n) => n.x + getNodeDimensions(n).width)) + 90;
      const maxY =
        Math.max(...nodes.map((n) => n.y + getNodeDimensions(n).height)) + 65;
      const scale = Math.min(
        1,
        el.clientWidth / (maxX - minX),
        el.clientHeight / (maxY - minY),
      );
      setView({
        scale,
        x: (el.clientWidth - (maxX - minX) * scale) / 2 - minX * scale,
        y: (el.clientHeight - (maxY - minY) * scale) / 2 - minY * scale,
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [workflow, fitRevision]);

  const zoom = (factor: number) => {
    const el = viewport.current;
    if (!el) return;
    setView((v) => {
      const scale = Math.min(2, Math.max(0.05, v.scale * factor));
      const ratio = scale / v.scale;
      return {
        scale,
        x: el.clientWidth / 2 - (el.clientWidth / 2 - v.x) * ratio,
        y: el.clientHeight / 2 - (el.clientHeight / 2 - v.y) * ratio,
      };
    });
  };

  return (
    <div
      ref={viewport}
      className="workflow-viewport relative h-full overflow-hidden bg-background touch-none"
      aria-label="Workflow canvas"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          originX: view.x,
          originY: view.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start)
          setView((v) => ({
            ...v,
            x: start.originX + event.clientX - start.x,
            y: start.originY + event.clientY - start.y,
          }));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--node-border) 1px, transparent 1px)',
          backgroundSize: `${20 * view.scale}px ${20 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          opacity: 0.5,
        }}
      />
      <div
        className="absolute origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        <svg
          className="absolute overflow-visible pointer-events-none"
          width="1"
          height="1"
          aria-hidden="true"
        >
          <defs>
            {['default', 'success', 'failure', 'attachment'].map((type) => (
              <marker
                key={type}
                id={`preview-arrow-${type}`}
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <polygon
                  points="0 0, 6 3, 0 6"
                  fill={
                    type === 'success'
                      ? '#4ade80'
                      : type === 'failure'
                        ? '#f87171'
                        : type === 'attachment'
                          ? 'var(--muted)'
                          : 'var(--node-border)'
                  }
                />
              </marker>
            ))}
          </defs>
          {workflow.connections.map((edge) => {
            const source = workflow.nodes.find((n) => n.id === edge.sourceId);
            const target = workflow.nodes.find((n) => n.id === edge.targetId);
            if (!source || !target) return null;
            const attachment = edge.role === 'attachment';
            const sourcePort = attachment ? 'top' : edge.sourcePort || 'right';
            const targetPort = attachment
              ? 'bottom'
              : edge.targetPort || 'left';
            const start = getPortCoordinates(source, sourcePort);
            const end =
              attachment && edge.attachmentPort
                ? getAttachmentPortCoordinates(target, edge.attachmentPort)
                : getPortCoordinates(target, targetPort, 10);
            const type = attachment
              ? 'attachment'
              : edge.type === 'success' || edge.type === 'failure'
                ? edge.type
                : 'default';
            return (
              <path
                key={edge.id}
                data-connection-id={edge.id}
                d={renderCurve(
                  start.x,
                  start.y,
                  end.x,
                  end.y,
                  sourcePort,
                  targetPort,
                  'step',
                )}
                stroke={
                  type === 'success'
                    ? '#4ade80'
                    : type === 'failure'
                      ? '#f87171'
                      : attachment
                        ? 'var(--muted)'
                        : 'var(--node-border)'
                }
                strokeWidth="2"
                fill="none"
                strokeDasharray={
                  attachment
                    ? '3 5'
                    : edge.type === 'independent' || edge.type === 'concurrent'
                      ? '6 4'
                      : undefined
                }
                markerEnd={
                  attachment ? undefined : `url(#preview-arrow-${type})`
                }
              />
            );
          })}
        </svg>
        {workflow.nodes.map((node) => {
          const type = ALL_NODE_TYPES.find((t) => t.id === node.nodeType);
          const isEnvironmentNode = node.nodeType === 'environment';
          const isScheduleNode = node.nodeType === 'schedule';
          const isAttachmentNode = type?.executionRole === 'attachment';
          const isAIContainer = node.nodeType === 'agent-container';
          const isSelected = selected === node.id;
          const dimensions = getNodeDimensions(node);
          const isConnected = (port: PortPosition) =>
            workflow.connections.some(
              (edge) =>
                (edge.sourceId === node.id &&
                  (edge.role === 'attachment'
                    ? 'top'
                    : edge.sourcePort || 'right') === port) ||
                (edge.targetId === node.id &&
                  edge.role !== 'attachment' &&
                  (edge.targetPort || 'left') === port),
            );
          return (
            <button
              key={node.id}
              type="button"
              data-node-id={node.id}
              data-testid={`canvas-node-${node.nodeType}`}
              aria-label={`${node.label} (${type?.label || node.nodeType})`}
              aria-pressed={isSelected}
              onClick={() => {
                setSelected(node.id);
                onSelect(node);
              }}
              className={`preview-node absolute flex flex-col justify-center select-none ${workflowNodeAppearance({ isEnvironmentNode, isScheduleNode, isAttachmentNode, isAIContainer, isSelected })}`}
              style={{ left: node.x, top: node.y, ...dimensions }}
            >
              {isEnvironmentNode && (
                <EnvironmentNodeShape isSelected={isSelected} />
              )}
              {isAIContainer ? (
                <>
                  <div className="flex min-h-0 flex-1 items-center gap-4 px-8 pb-12">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[var(--node-border)] bg-[var(--surface-hover)]">
                      <div className="scale-75">
                        <WorkflowNodeIcon nodeTypeId={node.nodeType} />
                      </div>
                    </div>
                    <div className="min-w-0 text-left">
                      <p className="truncate text-base font-semibold">
                        {node.label}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">Coding Agent</p>
                    </div>
                  </div>
                  {(['agent', 'memory', 'tool'] as const).map((kind, i) => (
                    <div
                      key={kind}
                      className="absolute bottom-0 h-12 -translate-x-1/2 flex flex-col items-center justify-center"
                      style={{ left: `${[18, 50, 82][i]}%` }}
                    >
                      <span className="text-[10px] font-semibold uppercase text-muted">
                        {kind === 'tool' ? 'Tools' : kind}
                      </span>
                      <span className="absolute -bottom-2 h-4 w-4 rotate-45 border border-[var(--muted)] bg-[var(--node-port-bg)]" />
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-center w-full h-full pointer-events-none">
                    <WorkflowNodeIcon nodeTypeId={node.nodeType} />
                  </div>
                  <span className="absolute top-[calc(100%+12px)] left-1/2 -translate-x-1/2 whitespace-nowrap text-base font-medium text-[var(--foreground)]">
                    {node.label}
                  </span>
                </>
              )}
              {(Object.keys(portPositions) as PortPosition[])
                .filter(
                  (port) =>
                    isConnected(port) ||
                    (!isScheduleNode &&
                      ((port === 'right' && !isAttachmentNode) ||
                        (port === 'top' && isAttachmentNode))),
                )
                .map((port) => (
                  <span
                    key={port}
                    data-port={port}
                    className={`absolute border border-[var(--node-port-border)] bg-[var(--node-port-bg)] ${isAttachmentNode ? 'h-4 w-4 rotate-45' : 'h-6 w-6 rounded-full'} ${portPositions[port]}`}
                  />
                ))}
              {!isScheduleNode &&
                !isAttachmentNode &&
                !isConnected('right') && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 -translate-y-1/2 left-full flex items-center -z-10"
                  >
                    <span className="w-10 h-0.5 bg-[var(--node-border)]" />
                    <span className="w-6 h-6 rounded-md bg-[var(--node-bg)] flex items-center justify-center text-muted">
                      <Plus className="w-4 h-4" />
                    </span>
                  </span>
                )}
            </button>
          );
        })}
      </div>
      {!workflow.nodes.length && (
        <p className="absolute inset-0 flex items-center justify-center text-muted">
          Waiting for the first node…
        </p>
      )}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-xl border border-subtle bg-surface p-1 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          onClick={() => zoom(1.2)}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center text-xs text-muted">
          {Math.round(view.scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          onClick={() => zoom(1 / 1.2)}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
