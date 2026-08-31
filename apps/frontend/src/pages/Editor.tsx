import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Plus,
  Maximize,
  Trash2,
  Play,
  Square,
  Loader2,
  CheckCircle2,
  Route,
  Activity,
  ChevronDown,
  ChevronRight,
  Code2,
  MoreHorizontal,
  X,
  Power,
  Settings,
  AlertTriangle,
  XCircle,
  Save,
  ShieldCheck,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  Paintbrush,
  ArrowLeft,
  Monitor,
  Clock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useHeader } from '../components/PageLayout';

import { NodeSelectorModal, NODE_TYPES } from '../components/NodeSelectorModal';
import type { AppNodeType } from '../components/NodeSelectorModal';
import { IntegrationConfigPanel } from '../components/IntegrationConfigPanel';
import { getIntegration } from '../integrations/registry';
import { LogsPanel, LogItem } from '../components/LogsPanel';
import { Button, ConfirmDialog } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { auth } from '../lib/auth';
import { DbAPI } from '../lib/db';
import { openAuthenticatedOutput } from '../lib/output-links';
import {
  CLOUD_PROVIDERS,
  getCloudProvider,
  getDefaultWorkflowCloudProviderId,
  getPreferredCloudProviderId,
} from '../runtime/cloudProviders';

interface NodeData {
  id: string;
  nodeType?: string;
  label: string;
  parentNodes?: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  config?: Record<string, any>;
  output?: Record<string, any>;
}

type PortPosition = 'top' | 'right' | 'bottom' | 'left';
type AttachmentKind = 'agent' | 'memory' | 'tool';

const AI_CONTAINER_WIDTH = 360;
const AI_CONTAINER_HEIGHT = 128;
const REGULAR_HEXAGON_WIDTH_RATIO = 2 / Math.sqrt(3);
// Retain the per-node controls so they can be restored without rebuilding the
// execution handlers or context-menu layout.
const SHOW_NODE_EXECUTION_CONTROLS = false;

function getNodeDimensions(node: NodeData) {
  if (node.nodeType === 'agent-container') {
    return { width: AI_CONTAINER_WIDTH, height: AI_CONTAINER_HEIGHT };
  }
  if (node.nodeType === 'environment') {
    return {
      width: node.height * REGULAR_HEXAGON_WIDTH_RATIO,
      height: node.height,
    };
  }
  return { width: node.width, height: node.height };
}

type ConnectionType =
  | 'sequential'
  | 'concurrent'
  | 'independent'
  | 'success'
  | 'failure';

type NodeExecutionStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'warning';

type RuntimePlaywrightChild = {
  childKind: 'aggregate' | 'discovery' | 'shard';
  id: string;
  logs: string[];
  output?: Record<string, any>;
  parentNodeId: string;
  shardIndex?: number;
  shardTotal?: number;
  status: NodeExecutionStatus;
};

type RuntimePlaywrightPlan = {
  aggregateCpu: number;
  aggregateMemoryGb: number;
  aggregateWorkers: number;
  count: number;
  cpuPerShard?: number;
  discovery: {
    fileCount: number;
    fullyParallel: boolean;
    projectCount: number;
    shardableUnits: number;
    testCount: number;
  };
  estimate?: {
    durationMs: number | null;
    historySamples: number;
    source: 'discovery' | 'history';
  };
  limits: {
    capacity: number;
    configured: number;
    useful: number;
  };
  mode: 'auto' | 'manual';
  memoryGbPerShard?: number;
  reason: string;
  workersPerShard: number;
};

function formatPlannedDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function isNodeExecutionStatus(value: string): value is NodeExecutionStatus {
  return (
    value === 'idle' ||
    value === 'pending' ||
    value === 'running' ||
    value === 'success' ||
    value === 'error' ||
    value === 'warning'
  );
}

interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  sourcePort?: PortPosition;
  targetPort?: PortPosition;
  type?: ConnectionType;
  role?: 'execution' | 'attachment';
  attachmentPort?: AttachmentKind;
}

interface DrawingConnection {
  fixedNodeId: string;
  fixedPort: PortPosition;
  isForward: boolean; // true if drawing from source to target, false if drawing from target to source
}

function nodeTypeAcceptsInboundConnection(typeId?: string) {
  const nodeType = NODE_TYPES.find((n) => n.id === typeId);
  return nodeType?.acceptsInboundConnection ?? true;
}

function getNodeType(typeId?: string) {
  return NODE_TYPES.find((nodeType) => nodeType.id === typeId);
}

function createCanvasConnection(
  source: NodeData,
  target: NodeData,
  sourcePort: PortPosition,
  targetPort: PortPosition,
): Connection | null {
  const sourceType = getNodeType(source.nodeType);
  const targetType = getNodeType(target.nodeType);
  if (sourceType?.executionRole === 'attachment') {
    const attachmentKind = sourceType.attachmentKind;
    if (
      !attachmentKind ||
      !targetType?.acceptsAttachments.includes(attachmentKind)
    ) {
      return null;
    }
    return {
      id: `c_${Date.now()}`,
      sourceId: source.id,
      sourcePort,
      targetId: target.id,
      targetPort,
      role: 'attachment',
      attachmentPort: attachmentKind,
    };
  }
  if (targetType?.executionRole === 'attachment') {
    const attachmentKind = targetType.attachmentKind;
    if (
      !attachmentKind ||
      !sourceType?.acceptsAttachments.includes(attachmentKind)
    ) {
      return null;
    }
    return {
      id: `c_${Date.now()}`,
      sourceId: target.id,
      sourcePort: targetPort,
      targetId: source.id,
      targetPort: sourcePort,
      role: 'attachment',
      attachmentPort: attachmentKind,
    };
  }
  if (!nodeTypeAcceptsInboundConnection(target.nodeType)) return null;
  return {
    id: `c_${Date.now()}`,
    sourceId: source.id,
    sourcePort,
    targetId: target.id,
    targetPort,
    role: 'execution',
  };
}

function renderNodeTypeIcon(
  nodeTypeId: string | undefined,
  alt: string,
): React.ReactNode {
  const nodeType = NODE_TYPES.find((candidate) => candidate.id === nodeTypeId);
  if (!nodeType) return undefined;

  if (nodeType.iconSrc) {
    if (nodeType.iconRenderMode === 'mask') {
      return (
        <div
          className="h-5 w-5 bg-current"
          style={{
            WebkitMaskImage: `url(${nodeType.iconSrc})`,
            WebkitMaskPosition: 'center',
            WebkitMaskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            maskImage: `url(${nodeType.iconSrc})`,
            maskPosition: 'center',
            maskRepeat: 'no-repeat',
            maskSize: 'contain',
          }}
        />
      );
    }

    return (
      <img
        src={nodeType.iconSrc}
        alt={alt}
        className="h-5 w-5 object-contain"
      />
    );
  }

  if (nodeType.fallbackIcon) {
    const FallbackIcon = nodeType.fallbackIcon;
    return <FallbackIcon className={cn('h-5 w-5', nodeType.color)} />;
  }

  return undefined;
}

type WorkflowStartupPhase =
  | 'preparing'
  | 'requesting'
  | 'orchestrator-triggered'
  | 'workflow-starting'
  | 'analyzing'
  | 'waiting-for-node'
  | 'failed';

interface WorkflowStartupStatus {
  detail: string;
  message: string;
  phase: WorkflowStartupPhase;
  providerId: string;
  startedAt: number;
  updatedAt: number;
}

interface WorkflowStartupUpdate {
  detail: string;
  message: string;
  phase: WorkflowStartupPhase;
}

const availableCloudProviders = CLOUD_PROVIDERS;
const WORKFLOW_STARTUP_STEPS = [
  'Request',
  'Orchestrator',
  'Workflow',
  'Graph',
  'Nodes',
];

function normalizeCloudProvider(raw: string): string {
  return raw.toUpperCase();
}

function getCloudProviderLabel(providerId: string): string {
  if (providerId === 'LOCAL_RUNNER') {
    return 'Local Runner';
  }

  return (
    getCloudProvider(providerId)?.label || normalizeCloudProvider(providerId)
  );
}

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

function appendLogByTimestamp(logs: LogItem[], log: LogItem): LogItem[] {
  return [...logs, log].sort((a, b) => {
    const timestampDelta =
      (a.timestampMs ?? a.receivedAtMs ?? 0) -
      (b.timestampMs ?? b.receivedAtMs ?? 0);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return (a.receivedAtMs ?? 0) - (b.receivedAtMs ?? 0);
  });
}

function resolveLogTimestamp(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function getWorkflowStartupStepIndex(phase: WorkflowStartupPhase): number {
  switch (phase) {
    case 'preparing':
    case 'requesting':
      return 0;
    case 'orchestrator-triggered':
      return 1;
    case 'workflow-starting':
      return 2;
    case 'analyzing':
      return 3;
    case 'waiting-for-node':
      return 4;
    case 'failed':
      return 0;
  }
}

function getWorkflowStartupUpdateFromEvent(
  data: Record<string, any>,
): WorkflowStartupUpdate | null {
  const message = typeof data.message === 'string' ? data.message : '';
  const level = typeof data.level === 'string' ? data.level : '';

  if (data.type === 'workflow_failed' || level === 'error') {
    return {
      detail: message || 'Workflow startup failed before node execution.',
      message: 'Workflow startup failed',
      phase: 'failed',
    };
  }

  if (message === 'Workflow execution requested.') {
    return {
      detail: 'Preparing cloud resources and runner settings.',
      message: 'Workflow execution requested',
      phase: 'requesting',
    };
  }

  if (message === 'Orchestrator Cloud Run Service triggered successfully.') {
    return {
      detail: 'Waiting for the workflow to start in the cloud orchestrator.',
      message: 'Orchestrator triggered',
      phase: 'orchestrator-triggered',
    };
  }

  if (message === 'Waiting for Cloud Run orchestrator to become ready.') {
    return {
      detail: 'Checking Cloud Run service health before starting the workflow.',
      message: 'Starting Cloud Run orchestrator',
      phase: 'orchestrator-triggered',
    };
  }

  if (message.startsWith('Cloud Run orchestrator is not ready yet')) {
    return {
      detail: message,
      message: 'Waiting for Cloud Run orchestrator',
      phase: 'orchestrator-triggered',
    };
  }

  if (message === 'Cloud Run orchestrator is ready.') {
    return {
      detail: 'Sending workflow execution request to the orchestrator.',
      message: 'Cloud Run orchestrator ready',
      phase: 'orchestrator-triggered',
    };
  }

  if (message.startsWith('Cloud Run orchestrator invoke returned')) {
    return {
      detail: message,
      message: 'Retrying orchestrator trigger',
      phase: 'orchestrator-triggered',
    };
  }

  if (message === 'Workflow execution started.') {
    return {
      detail: 'Cloud orchestrator accepted the workflow.',
      message: 'Workflow execution started',
      phase: 'workflow-starting',
    };
  }

  if (/^Analyzing \d+ workflow connections\.\.\.$/.test(message)) {
    return {
      detail: message,
      message: 'Analyzing workflow graph',
      phase: 'analyzing',
    };
  }

  if (/^Connection .+ is marked as \[[A-Z]+\]$/.test(message)) {
    return {
      detail: 'Workflow graph analyzed. Waiting for the first node.',
      message: 'Waiting for first node to start',
      phase: 'waiting-for-node',
    };
  }

  return null;
}

function WorkflowStartupStatusPanel({
  elapsedMs,
  status,
}: {
  elapsedMs: number;
  status: WorkflowStartupStatus;
}) {
  const providerLabel = getCloudProviderLabel(status.providerId);
  const isFailed = status.phase === 'failed';
  const currentStepIndex = getWorkflowStartupStepIndex(status.phase);

  return (
    <div
      className="pointer-events-none absolute left-3 right-14 top-3 z-30 sm:left-1/2 sm:right-auto sm:w-[520px] sm:max-w-[calc(100vw-8rem)] sm:-translate-x-1/2"
      aria-live="polite"
    >
      <div
        className={cn(
          'rounded-xl border bg-[var(--surface)]/95 px-4 py-3 shadow-sm backdrop-blur',
          isFailed ? 'border-red-500/30' : 'border-[var(--border)]',
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
              isFailed
                ? 'border-red-500/20 bg-red-500/10 text-red-500'
                : 'border-[var(--border)] bg-[var(--surface-hover)] text-[var(--foreground)]',
            )}
          >
            {isFailed ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
                {status.message}
              </p>
              <Badge
                variant={isFailed ? 'danger' : 'outline'}
                className="shrink-0 whitespace-nowrap"
              >
                {providerLabel}
              </Badge>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                {formatElapsedTime(elapsedMs)} elapsed
              </span>
            </div>
            <p className="truncate text-xs leading-relaxed text-muted">
              {status.detail}
            </p>
            <div className="grid grid-cols-5 gap-x-2 gap-y-2 pt-1">
              {WORKFLOW_STARTUP_STEPS.map((step) => (
                <span
                  key={step}
                  className="min-w-0 truncate text-center text-[10px] font-medium uppercase tracking-wider text-muted"
                >
                  {step}
                </span>
              ))}
              {WORKFLOW_STARTUP_STEPS.map((step, index) => (
                <span
                  key={`${step}-progress`}
                  className={cn(
                    'h-1.5 min-w-0 rounded-full transition-colors',
                    !isFailed && index <= currentStepIndex
                      ? 'bg-[var(--accent)]'
                      : 'bg-[var(--border)]',
                    isFailed && index === currentStepIndex && 'bg-red-500',
                  )}
                  aria-hidden="true"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CloudProviderDropdown({
  value,
  onChange,
  onOpenSettings,
  connectedIds,
  cloudProjectId,
  providers,
}: {
  value: string;
  onChange: (v: string) => void;
  onOpenSettings: () => void;
  connectedIds: Set<string>;
  cloudProjectId?: string;
  providers: typeof CLOUD_PROVIDERS;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isLocal = value === 'LOCAL_RUNNER';
  const selectedCloud = providers.find((p) => p.id === value);
  const displayIcon = isLocal ? null : selectedCloud?.icon;
  const displayLabel = isLocal
    ? 'Local Runner'
    : cloudProjectId || selectedCloud?.label || value;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        data-testid="workflow-runner-selector"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 hover:bg-surface-hover text-sm font-medium text-[var(--foreground)] rounded-full py-1.5 px-3 focus:outline-none transition-colors"
        title={displayLabel}
      >
        {displayIcon ? (
          <img
            src={displayIcon}
            alt={displayLabel}
            className="w-5 h-5 object-contain"
          />
        ) : (
          <Monitor className="w-4 h-4 text-muted" />
        )}
        <span className="max-w-[160px] truncate">{displayLabel}</span>
        <ChevronDown
          className={cn(
            'w-3 h-3 text-muted transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-surface border border-subtle rounded-xl shadow-xl overflow-hidden flex flex-col z-50">
          <div className="p-1">
            {/* Local Dev option */}
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                onChange('LOCAL_RUNNER');
                setIsOpen(false);
              }}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2 text-sm rounded-lg transition-colors text-left',
                isLocal
                  ? 'bg-[var(--accent)]/10 text-[var(--foreground)]'
                  : 'text-[var(--foreground)] hover:bg-surface-hover',
              )}
            >
              <Monitor className="w-4 h-4 text-muted flex-shrink-0" />
              <span className="flex-1">Local Runner</span>
              {isLocal && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0" />
              )}
            </button>

            <div className="my-1 border-t border-subtle" />

            {providers
              .filter((provider) => provider.id !== 'LOCAL_RUNNER')
              .map((provider) => {
                const isConnected = connectedIds.has(provider.id);
                const isDisabled = Boolean(provider.disabled);
                return (
                  <button
                    key={provider.id}
                    type="button"
                    data-testid={`workflow-runner-option-${provider.id}`}
                    onClick={() => {
                      if (isDisabled) {
                        setNotice(provider.disabledReason || 'Premium feature');
                        return;
                      }
                      setNotice(null);
                      onChange(provider.id);
                      setIsOpen(false);
                      onOpenSettings();
                    }}
                    title={provider.disabledReason}
                    className={cn(
                      'flex items-center gap-3 w-full px-3 py-2 text-sm rounded-lg transition-colors text-left',
                      isDisabled && 'opacity-60 cursor-not-allowed',
                      value === provider.id && !isDisabled
                        ? 'bg-[var(--accent)]/10 text-[var(--foreground)]'
                        : isDisabled
                          ? 'text-muted'
                          : 'text-[var(--foreground)] hover:bg-surface-hover',
                    )}
                  >
                    <img
                      src={provider.icon}
                      alt={provider.label}
                      className="w-4 h-4 object-contain flex-shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {provider.label}
                    </span>
                    {provider.isPremiumFeature && !isConnected ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 whitespace-nowrap px-1.5 py-0 text-[9px] uppercase tracking-[0.16em]"
                      >
                        COMING SOON
                      </Badge>
                    ) : (
                      <span
                        className={cn(
                          'w-2 h-2 rounded-full flex-shrink-0 transition-colors',
                          isConnected
                            ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]'
                            : 'border border-[var(--muted)] bg-transparent',
                        )}
                        title={isConnected ? 'Connected' : 'Not connected'}
                      />
                    )}
                  </button>
                );
              })}
          </div>
          {notice ? (
            <div className="border-t border-subtle px-3 py-2 text-xs text-muted">
              {notice}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function Editor() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: workflowId } = useParams<{ id: string }>();
  const activeWorkflowId = workflowId || 'current';
  const { setHeaderLeft, setHeaderCenter } = useHeader();
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');
  const [workflowAccess, setWorkflowAccess] = useState<{
    canEdit: boolean;
    canRun: boolean;
    permission: 'owner' | 'view_run';
    sharedTeams: Array<{ id: string; name: string }>;
  } | null>(null);
  const isReadOnly = workflowAccess?.canEdit === false;
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingLabelNodeId, setEditingLabelNodeId] = useState<string | null>(
    null,
  );

  const initialNodes = location.state?.initialNodes as NodeData[] | undefined;
  const initialConnections = location.state?.initialConnections as
    | Connection[]
    | undefined;

  const [nodes, setNodes] = useState<NodeData[]>(initialNodes || []);
  const [connections, setConnections] = useState<Connection[]>(
    initialConnections || [],
  );
  const [concurrency, setConcurrency] = useState<number>(1);

  const [isOrchestratorReady, setIsOrchestratorReady] = useState(false);
  const [orchestratorStartError, setOrchestratorStartError] = useState<
    string | null
  >(null);
  const [orchestratorStartAttempt, setOrchestratorStartAttempt] = useState(0);
  const [orchestratorLogs, setOrchestratorLogs] = useState<LogItem[]>([]);
  const [workflowStartupStatus, setWorkflowStartupStatus] =
    useState<WorkflowStartupStatus | null>(null);
  const [workflowStartupNow, setWorkflowStartupNow] = useState(Date.now());
  const presenceStreamRef = useRef<EventSource | null>(null);
  const executionStreamRef = useRef<EventSource | null>(null);
  const activeExecutionIdRef = useRef<string | null>(null);
  const hasOpenedCloudSettingsRef = useRef(false);
  const runnerStartupSequenceRef = useRef(0);
  const [isWorkflowLoaded, setIsWorkflowLoaded] = useState(
    Boolean(initialNodes && initialConnections),
  );
  const [cloudProvider, setCloudProvider] = useState<string>(
    getDefaultWorkflowCloudProviderId,
  );
  const [cloudProjectId, setCloudProjectId] = useState<string>('');
  const [isCloudSettingsOpen, setIsCloudSettingsOpen] = useState(false);
  const [connectedCloudIds, setConnectedCloudIds] = useState<Set<string>>(
    new Set(),
  );
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const appendOrchestratorLog = React.useCallback(
    (
      message: string,
      type: LogItem['type'] = 'Info',
      timestamp = new Date(),
    ) => {
      const receivedAtMs = Date.now();
      setOrchestratorLogs((prev) =>
        appendLogByTimestamp(prev, {
          id: `log-${receivedAtMs}-${Math.random()}`,
          type,
          message: `[${timestamp.toLocaleTimeString()}] ${message}`,
          receivedAtMs,
          timestampMs: timestamp.getTime(),
        }),
      );
    },
    [],
  );

  const beginWorkflowStartupStatus = useCallback((providerId: string) => {
    if (providerId === 'LOCAL_RUNNER') {
      setWorkflowStartupStatus(null);
      return;
    }

    const now = Date.now();
    const providerLabel = getCloudProviderLabel(providerId);
    setWorkflowStartupNow(now);
    setWorkflowStartupStatus({
      detail: 'Loading credentials and preparing the workflow request.',
      message: `Starting workflow in ${providerLabel}`,
      phase: 'preparing',
      providerId,
      startedAt: now,
      updatedAt: now,
    });
  }, []);

  const updateWorkflowStartupStatus = useCallback(
    (update: WorkflowStartupUpdate) => {
      const now = Date.now();
      setWorkflowStartupNow(now);
      setWorkflowStartupStatus((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          ...update,
          updatedAt: now,
        };
      });
    },
    [],
  );

  const clearWorkflowStartupStatus = useCallback(() => {
    setWorkflowStartupStatus(null);
  }, []);

  useEffect(() => {
    if (!workflowStartupStatus || workflowStartupStatus.phase === 'failed') {
      return;
    }

    const timer = window.setInterval(() => {
      setWorkflowStartupNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [workflowStartupStatus]);

  const closePresenceStream = useCallback(() => {
    if (presenceStreamRef.current) {
      console.info('[presence] closing editor presence stream');
    }
    presenceStreamRef.current?.close();
    presenceStreamRef.current = null;
  }, []);

  const invalidateRunnerStartupSequence = useCallback(() => {
    runnerStartupSequenceRef.current += 1;
    return runnerStartupSequenceRef.current;
  }, []);

  const closeExecutionStream = useCallback(() => {
    executionStreamRef.current?.close();
    executionStreamRef.current = null;
    activeExecutionIdRef.current = null;
  }, []);

  const handleExecutionEvent = useCallback(
    (data: Record<string, any>) => {
      const timestamp = resolveLogTimestamp(data.timestamp);
      const startupUpdate = getWorkflowStartupUpdateFromEvent(data);
      if (startupUpdate) {
        updateWorkflowStartupStatus(startupUpdate);
      }

      if (
        data.type === 'node_state' &&
        typeof data.nodeId === 'string' &&
        typeof data.state === 'string' &&
        isNodeExecutionStatus(data.state)
      ) {
        if (data.state === 'running') {
          clearWorkflowStartupStatus();
        }
        if (
          typeof data.parentNodeId === 'string' &&
          (data.childKind === 'aggregate' ||
            data.childKind === 'discovery' ||
            data.childKind === 'shard')
        ) {
          setRuntimePlaywrightChildren((previous) => ({
            ...previous,
            [data.parentNodeId]: {
              ...(previous[data.parentNodeId] || {}),
              [data.nodeId]: {
                childKind: data.childKind,
                id: data.nodeId,
                logs: previous[data.parentNodeId]?.[data.nodeId]?.logs || [],
                output: previous[data.parentNodeId]?.[data.nodeId]?.output,
                parentNodeId: data.parentNodeId,
                shardIndex: data.shardIndex,
                shardTotal: data.shardTotal,
                status: data.state,
              },
            },
          }));
          return;
        }
        setNodeStatus((prev) => ({ ...prev, [data.nodeId]: data.state }));
        return;
      }

      if (data.type === 'node_output' && typeof data.nodeId === 'string') {
        if (
          typeof data.parentNodeId === 'string' &&
          (data.childKind === 'aggregate' ||
            data.childKind === 'discovery' ||
            data.childKind === 'shard')
        ) {
          setRuntimePlaywrightChildren((previous) => {
            const existing = previous[data.parentNodeId]?.[data.nodeId];
            return {
              ...previous,
              [data.parentNodeId]: {
                ...(previous[data.parentNodeId] || {}),
                [data.nodeId]: {
                  childKind: data.childKind,
                  id: data.nodeId,
                  logs: existing?.logs || [],
                  output: data.output,
                  parentNodeId: data.parentNodeId,
                  shardIndex: data.shardIndex,
                  shardTotal: data.shardTotal,
                  status: existing?.status || 'running',
                },
              },
            };
          });
          return;
        }
        setNodes((prev) =>
          prev.map((n) =>
            n.id === data.nodeId ? { ...n, output: data.output } : n,
          ),
        );
        return;
      }

      if (data.type === 'shard_plan' && typeof data.nodeId === 'string') {
        if (data.plan && typeof data.plan === 'object') {
          setRuntimePlaywrightPlans((previous) => ({
            ...previous,
            [data.nodeId]: data.plan as RuntimePlaywrightPlan,
          }));
        }
        const runtimeChildren: RuntimePlaywrightChild[] = [
          {
            childKind: 'discovery' as const,
            id: `${data.nodeId}--discovery`,
            logs: [],
            output: data.discovery ? { discovery: data.discovery } : undefined,
            parentNodeId: data.nodeId,
            status: 'success' as const,
          },
          ...(Array.isArray(data.children) ? data.children : []).map(
            (child: Record<string, any>) => ({
              childKind: 'shard' as const,
              id: child.nodeId,
              logs: [],
              parentNodeId: data.nodeId,
              shardIndex: child.shardIndex,
              shardTotal: child.shardTotal,
              status: 'pending' as const,
            }),
          ),
          {
            childKind: 'aggregate' as const,
            id: data.aggregateNodeId,
            logs: [],
            parentNodeId: data.nodeId,
            status: 'pending' as const,
          },
        ].filter((child) => typeof child.id === 'string');
        setRuntimePlaywrightChildren((previous) => ({
          ...previous,
          [data.nodeId]: Object.fromEntries(
            runtimeChildren.map((child) => [
              child.id,
              {
                ...previous[data.nodeId]?.[child.id],
                ...child,
                logs: previous[data.nodeId]?.[child.id]?.logs || child.logs,
              },
            ]),
          ),
        }));
        setExpandedRuntimeNodes((previous) => ({
          ...previous,
          [data.nodeId]: true,
        }));
        return;
      }

      if (
        data.type === 'workflow_completed' ||
        data.type === 'workflow_failed' ||
        data.type === 'workflow_cancelled'
      ) {
        isSimulationRunning.current = false;
        setSimulationState('idle');
        if (data.type !== 'workflow_failed') {
          clearWorkflowStartupStatus();
        }
        closeExecutionStream();
      }

      if (typeof data.message !== 'string' || data.message.length === 0) {
        return;
      }

      if (
        typeof data.parentNodeId === 'string' &&
        typeof data.nodeId === 'string' &&
        (data.childKind === 'aggregate' ||
          data.childKind === 'discovery' ||
          data.childKind === 'shard')
      ) {
        setRuntimePlaywrightChildren((previous) => {
          const existing = previous[data.parentNodeId]?.[data.nodeId];
          return {
            ...previous,
            [data.parentNodeId]: {
              ...(previous[data.parentNodeId] || {}),
              [data.nodeId]: {
                childKind: data.childKind,
                id: data.nodeId,
                logs: [...(existing?.logs || []), data.message],
                output: existing?.output,
                parentNodeId: data.parentNodeId,
                shardIndex: data.shardIndex,
                shardTotal: data.shardTotal,
                status: existing?.status || 'running',
              },
            },
          };
        });
      }

      if (data.message.startsWith('Processing node:')) {
        clearWorkflowStartupStatus();
      }

      let logType: LogItem['type'] = 'Log';
      if (data.level === 'error') logType = 'Error';
      if (data.level === 'warning' || data.level === 'warn')
        logType = 'Warning';
      if (data.level === 'info') logType = 'Info';
      if (data.level === 'debug') logType = 'Debug';

      const receivedAtMs = Date.now();
      setOrchestratorLogs((prev) =>
        appendLogByTimestamp(prev, {
          id: `log-${receivedAtMs}-${Math.random()}`,
          type: logType,
          message: `[${timestamp.toLocaleTimeString()}] ${data.message}`,
          receivedAtMs,
          timestampMs: timestamp.getTime(),
        }),
      );
    },
    [
      clearWorkflowStartupStatus,
      closeExecutionStream,
      updateWorkflowStartupStatus,
    ],
  );

  useEffect(() => {
    if (!isWorkflowLoaded) {
      setIsOrchestratorReady(false);
      setOrchestratorStartError(null);
      return;
    }

    let isDisposed = false;

    const unsubscribeRunner = auth.onAuthStateChanged(async (user) => {
      const startupSequence = invalidateRunnerStartupSequence();
      const isStale = () =>
        isDisposed || startupSequence !== runnerStartupSequenceRef.current;

      closePresenceStream();
      closeExecutionStream();

      if (!user) {
        setIsOrchestratorReady(false);
        setOrchestratorStartError(null);
        return;
      }

      try {
        setIsOrchestratorReady(false);
        setOrchestratorStartError(null);
        const token = await user.getIdToken();
        if (isStale()) {
          console.info(
            `[presence] aborting stale runner startup seq=${startupSequence} before stream open`,
          );
          return;
        }

        console.info(
          `[presence] opening editor presence stream seq=${startupSequence}`,
        );
        const presenceStream = new EventSource(
          `/api/presence/stream?token=${encodeURIComponent(token)}`,
        );
        presenceStream.onopen = () => {
          if (!isDisposed) {
            console.info(
              `[presence] editor presence stream connected seq=${startupSequence}`,
            );
          }
        };
        presenceStream.onerror = () => {
          if (!isDisposed) {
            console.error(
              `[presence] editor presence stream disconnected seq=${startupSequence}.`,
            );
          }
        };

        if (isStale()) {
          console.info(
            `[presence] closing stale editor presence stream seq=${startupSequence} immediately after open`,
          );
          presenceStream.close();
          return;
        }

        presenceStreamRef.current = presenceStream;

        if (cloudProvider !== 'LOCAL_RUNNER') {
          appendOrchestratorLog(
            `${cloudProvider} runner selected. Local Docker orchestrator startup skipped.`,
            'Info',
          );
          setIsOrchestratorReady(true);
          return;
        }

        const response = await fetch('/api/runners/start', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cloudProvider }),
        });
        const payload = await response.json().catch(() => null);
        if (isStale()) {
          console.info(
            `[presence] aborting stale runner startup seq=${startupSequence} after start request`,
          );
          return;
        }

        if (!response.ok) {
          throw new Error(
            payload?.error ||
              payload?.message ||
              `Runner start failed with status ${response.status}`,
          );
        }
        appendOrchestratorLog(
          payload?.message || 'Runner startup requested.',
          'Info',
        );
        setIsOrchestratorReady(true);
      } catch (err) {
        if (isStale()) {
          console.info(
            `[presence] ignoring stale runner startup error seq=${startupSequence}`,
          );
          return;
        }

        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Failed to start orchestrator:', err);
        appendOrchestratorLog(
          `Failed to start orchestrator: ${message}`,
          'Error',
        );
        setOrchestratorStartError(message);
        setIsOrchestratorReady(false);
      }
    });

    return () => {
      isDisposed = true;
      invalidateRunnerStartupSequence();
      closePresenceStream();
      closeExecutionStream();
      unsubscribeRunner();
    };
  }, [
    appendOrchestratorLog,
    cloudProvider,
    closeExecutionStream,
    closePresenceStream,
    invalidateRunnerStartupSequence,
    isWorkflowLoaded,
    orchestratorStartAttempt,
  ]);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<
    Set<string>
  >(new Set());
  const [pendingNodeDeletion, setPendingNodeDeletion] = useState<{
    nodeIds: string[];
    connectionIds: string[];
  } | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(
    null,
  );
  const [connectionMenuId, setConnectionMenuId] = useState<string | null>(null);
  const [connectionStyle, setConnectionStyle] = useState<'step' | 'bezier'>(
    'step',
  );

  const [showNodeSelector, setShowNodeSelector] = useState(false);
  const [nodeSelectorPos, setNodeSelectorPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [pendingConnectionSource, setPendingConnectionSource] =
    useState<DrawingConnection | null>(null);
  const [pendingAttachmentKind, setPendingAttachmentKind] =
    useState<AttachmentKind | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [shouldAutoSave, setShouldAutoSave] = useState(false);

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'info',
  ) => {
    setSaveStatus({ message, type });
    setTimeout(() => setSaveStatus(null), 3000);
  };

  useEffect(() => {
    if (initialNodes && initialConnections) {
      setIsWorkflowLoaded(true);
      return;
    }

    const loadWorkflow = async () => {
      try {
        let loaded = false;
        if (auth.currentUser) {
          try {
            const data = await DbAPI.getWorkflow(
              auth.currentUser.uid,
              activeWorkflowId,
            );
            if (data) {
              if (data.access) setWorkflowAccess(data.access);
              if (data.nodes) setNodes(data.nodes);
              if (data.connections) setConnections(data.connections);
              if (data.name) setWorkflowName(data.name);
              if (data.title) setWorkflowName(data.title);
              if (data.projectId) setProjectId(data.projectId);
              if (data.concurrency) setConcurrency(data.concurrency);
              if (data.cloudProvider)
                setCloudProvider(normalizeCloudProvider(data.cloudProvider));
              else if (data.provider)
                setCloudProvider(normalizeCloudProvider(data.provider));
              loaded = true;
            }
          } catch (err) {
            console.error(
              'Failed to load workflow from the local database:',
              err,
            );
          }
        }

        if (!loaded) {
          const localData = localStorage.getItem('playrunner_local_workflow');
          if (localData) {
            try {
              const parsed = JSON.parse(localData);
              if (parsed.nodes) setNodes(parsed.nodes);
              if (parsed.connections) setConnections(parsed.connections);
              if (parsed.name) setWorkflowName(parsed.name);
              if (parsed.title) setWorkflowName(parsed.title);
              if (parsed.projectId) setProjectId(parsed.projectId);
              if (parsed.concurrency) setConcurrency(parsed.concurrency);
              if (parsed.cloudProvider)
                setCloudProvider(normalizeCloudProvider(parsed.cloudProvider));
              else if (parsed.provider)
                setCloudProvider(normalizeCloudProvider(parsed.provider));
              loaded = true;
            } catch (error) {
              console.error(
                'Failed to parse local workflow from localStorage:',
                error,
              );
            }
          }
        }

        if (!loaded) {
          // Load sample or previously saved nodes
          const sampleNodes: NodeData[] = [
            {
              id: 'n1',
              nodeType: 'playwright',
              label: 'Playwright',
              x: 400,
              y: 300,
              width: 128,
              height: 128,
            },
            {
              id: 'n2',
              nodeType: 'jira',
              label: 'Jira',
              x: 800,
              y: 100,
              width: 128,
              height: 128,
            },
            {
              id: 'n3',
              nodeType: 'google-chat',
              label: 'Google Chat',
              x: 800,
              y: 300,
              width: 128,
              height: 128,
            },
            {
              id: 'n4',
              nodeType: 'asana',
              label: 'Asana',
              x: 800,
              y: 500,
              width: 128,
              height: 128,
            },
          ];

          const sampleConnections: Connection[] = [
            {
              id: 'c1',
              sourceId: 'n1',
              targetId: 'n2',
              sourcePort: 'right',
              targetPort: 'left',
            },
            {
              id: 'c2',
              sourceId: 'n1',
              targetId: 'n3',
              sourcePort: 'right',
              targetPort: 'left',
            },
            {
              id: 'c3',
              sourceId: 'n1',
              targetId: 'n4',
              sourcePort: 'right',
              targetPort: 'left',
            },
          ];

          setNodes(sampleNodes);
          setConnections(sampleConnections);
        }
      } finally {
        setIsWorkflowLoaded(true);
      }
    };

    const unsubscribe = auth.onAuthStateChanged(() => {
      loadWorkflow();
    });

    return () => unsubscribe();
  }, [activeWorkflowId, initialNodes, initialConnections]);

  const canvasRef = useRef<HTMLDivElement>(null);

  const [isPanning, setIsPanning] = useState(false);
  const [isDraggingNode, setIsDraggingNode] = useState<string | null>(null);
  const [isDrawingConnection, setIsDrawingConnection] =
    useState<DrawingConnection | null>(null); // source nodeId

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 }); // Document coordinates
  const lastPanPos = useRef({ x: 0, y: 0 });
  const lastNodeDragPos = useRef({ x: 0, y: 0 });

  // Simulation State
  const [simulationState, setSimulationState] = useState<'idle' | 'running'>(
    'idle',
  );
  const [nodeStatus, setNodeStatus] = useState<
    Record<string, NodeExecutionStatus>
  >({});
  const [runtimePlaywrightChildren, setRuntimePlaywrightChildren] = useState<
    Record<string, Record<string, RuntimePlaywrightChild>>
  >({});
  const [runtimePlaywrightPlans, setRuntimePlaywrightPlans] = useState<
    Record<string, RuntimePlaywrightPlan>
  >({});
  const [expandedRuntimeNodes, setExpandedRuntimeNodes] = useState<
    Record<string, boolean>
  >({});
  const [selectedRuntimeChildId, setSelectedRuntimeChildId] = useState<
    string | null
  >(null);
  const selectedRuntimeChild = Object.values(runtimePlaywrightChildren)
    .flatMap((children) => Object.values(children))
    .find((child) => child.id === selectedRuntimeChildId);
  const isSimulationRunning = useRef(false);

  const [openNodeSettingsId, setOpenNodeSettingsId] = useState<string | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);

  const getNodesWithParents = useCallback(() => {
    return nodes.map((node) => {
      const parentNodes = connections
        .filter((c) => c.targetId === node.id && c.role !== 'attachment')
        .map((c) => c.sourceId);
      return {
        ...node,
        parentNodes: parentNodes.length > 0 ? parentNodes : [],
      };
    });
  }, [nodes, connections]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            nodes: getNodesWithParents(),
            connections,
            cloudProvider,
            concurrency,
          },
          null,
          2,
        ),
      );
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy JSON', err);
    }
  };
  const [activeIntegrationSettingsId, setActiveIntegrationSettingsId] =
    useState<string | null>(null);
  const activeCloudProvider = getCloudProvider(cloudProvider);
  const ActiveCloudSettingsModal = activeCloudProvider?.SettingsModal;
  const ActiveIntegrationSettingsModal = activeIntegrationSettingsId
    ? getIntegration(activeIntegrationSettingsId)?.SettingsModal
    : undefined;

  useEffect(() => {
    if (isCloudSettingsOpen) {
      hasOpenedCloudSettingsRef.current = true;
      return;
    }

    if (hasOpenedCloudSettingsRef.current) {
      setCloudProvider(getPreferredCloudProviderId());
    }
  }, [isCloudSettingsOpen]);

  // Fetch connection status and selected project for all cloud providers
  useEffect(() => {
    const checkConnections = async (user: any) => {
      if (!user) return;
      setCloudProjectId('');
      const results = await Promise.all(
        availableCloudProviders
          .filter((provider) => provider.credentialId)
          .map(async (p) => {
            try {
              const data = await DbAPI.getCloudCredential(
                user.uid,
                p.credentialId!,
              );
              if (p.id === cloudProvider && data?.config?.selectedProject) {
                setCloudProjectId(data.config.selectedProject);
              }
              return data?.credentialStatus?.configured ? p.id : null;
            } catch {
              return null;
            }
          }),
      );
      setConnectedCloudIds(new Set(results.filter(Boolean) as string[]));
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      checkConnections(user);
    });

    return () => unsubscribe();
  }, [cloudProvider, isCloudSettingsOpen]);

  const startWorkflowExecution = useCallback(
    async (
      nodesToRun: NodeData[],
      connectionsToRun: Connection[],
      currentCloudProvider: string,
    ) => {
      const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
      if (!token) {
        throw new Error('You must be signed in to run workflows.');
      }

      if (currentCloudProvider !== 'LOCAL_RUNNER') {
        updateWorkflowStartupStatus({
          detail: 'Requesting execution and triggering the cloud orchestrator.',
          message: `Starting workflow in ${getCloudProviderLabel(
            currentCloudProvider,
          )}`,
          phase: 'requesting',
        });
      }

      const response = await fetch('/api/workflows/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nodes: nodesToRun,
          connections: connectionsToRun,
          workflowId: activeWorkflowId,
          workflow: {
            definition: {
              id: activeWorkflowId,
              name: workflowName,
            },
            run: {
              runner: currentCloudProvider,
              trigger: 'manual',
              url: `${window.location.origin}/workflow/${activeWorkflowId}`,
            },
          },
          cloudProvider: currentCloudProvider,
          concurrency,
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        code?: string;
        error?: string;
        message?: string;
        testId?: string;
      } | null;
      if (!response.ok) {
        const error = new Error(
          payload?.error ||
            payload?.message ||
            `Workflow start failed with status ${response.status}`,
        );
        if (payload?.code) {
          (error as Error & { code?: string }).code = payload.code;
        }
        throw error;
      }

      if (!payload?.testId) {
        throw new Error('Workflow start response did not include a testId.');
      }

      if (currentCloudProvider !== 'LOCAL_RUNNER') {
        updateWorkflowStartupStatus({
          detail: 'Workflow request accepted. Connecting to live events.',
          message: 'Waiting for workflow events',
          phase: 'orchestrator-triggered',
        });
      }

      closeExecutionStream();
      activeExecutionIdRef.current = payload.testId;
      const eventSource = new EventSource(
        `/api/executions/${encodeURIComponent(payload.testId)}/stream?token=${encodeURIComponent(token)}`,
      );
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleExecutionEvent(data);
        } catch (error) {
          console.error('Execution SSE parse error:', error, event.data);
        }
      };
      eventSource.onerror = () => {
        if (isSimulationRunning.current) {
          console.error(`Execution SSE disconnected for ${payload.testId}.`);
        }
      };
      executionStreamRef.current = eventSource;
    },
    [
      activeWorkflowId,
      closeExecutionStream,
      concurrency,
      handleExecutionEvent,
      updateWorkflowStartupStatus,
      workflowName,
    ],
  );

  const runWorkflow = useCallback(
    (
      nodesToRun: NodeData[],
      connectionsToRun: Connection[],
      currentCloudProvider: string,
    ) => {
      startWorkflowExecution(
        nodesToRun,
        connectionsToRun,
        currentCloudProvider,
      ).catch((err) => {
        console.error('Failed to start workflow API:', err);
        if (currentCloudProvider !== 'LOCAL_RUNNER') {
          updateWorkflowStartupStatus({
            detail: err instanceof Error ? err.message : 'Unknown error',
            message: 'Workflow startup failed',
            phase: 'failed',
          });
        }
        appendOrchestratorLog(
          `Failed to start workflow: ${err instanceof Error ? err.message : 'Unknown error'}`,
          'Error',
        );
        isSimulationRunning.current = false;
        setSimulationState('idle');
      });
    },
    [
      appendOrchestratorLog,
      startWorkflowExecution,
      updateWorkflowStartupStatus,
    ],
  );

  const handlePlay = useCallback(async () => {
    if (isSimulationRunning.current) return;
    isSimulationRunning.current = true;
    setSimulationState('running');
    setNodeStatus({});
    setRuntimePlaywrightChildren({});
    setRuntimePlaywrightPlans({});
    setExpandedRuntimeNodes({});
    setSelectedRuntimeChildId(null);
    setNodes((prev) => prev.map((node) => ({ ...node, output: undefined })));

    const currentCloudProvider = cloudProvider || 'LOCAL_RUNNER';
    beginWorkflowStartupStatus(currentCloudProvider);

    if (!auth.currentUser) {
      console.warn('auth.currentUser is null when handlePlay is called!');
    }

    runWorkflow(getNodesWithParents(), connections, currentCloudProvider);
  }, [
    beginWorkflowStartupStatus,
    cloudProvider,
    connections,
    getNodesWithParents,
    runWorkflow,
  ]);

  const handlePlayNode = async (nodeId: string) => {
    if (isSimulationRunning.current) return;
    isSimulationRunning.current = true;
    setSimulationState('running');
    setNodeStatus({});
    setRuntimePlaywrightChildren({});
    setRuntimePlaywrightPlans({});
    setExpandedRuntimeNodes({});
    setSelectedRuntimeChildId(null);
    setNodes((prev) => prev.map((node) => ({ ...node, output: undefined })));

    const currentCloudProvider = cloudProvider || 'LOCAL_RUNNER';
    beginWorkflowStartupStatus(currentCloudProvider);

    if (!auth.currentUser) {
      console.warn('auth.currentUser is null when handlePlayNode is called!');
    }

    // Send the target, ordinary Environment nodes, and attached capabilities.
    // We disguise the environment node's ID so the UI doesn't visually "play" it as well.
    const attachmentConnections = connections.filter(
      (connection) =>
        connection.role === 'attachment' && connection.targetId === nodeId,
    );
    const attachmentNodeIds = new Set(
      attachmentConnections.map((connection) => connection.sourceId),
    );
    const nodesToRun = getNodesWithParents()
      .filter(
        (n) =>
          n.id === nodeId ||
          n.nodeType === 'environment' ||
          attachmentNodeIds.has(n.id),
      )
      .map((n) => {
        if (n.id !== nodeId && n.nodeType === 'environment') {
          return { ...n, id: `hidden_${n.id}` };
        }
        return n;
      });

    runWorkflow(nodesToRun, attachmentConnections, currentCloudProvider);
  };

  const handleStopNode = async (nodeId: string) => {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
    fetch('/api/workflows/stop-node', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        executionId: activeExecutionIdRef.current,
        nodeId,
      }),
    }).catch(console.error);

    // Optimistically update UI
    setNodeStatus((prev) => ({ ...prev, [nodeId]: 'idle' }));
  };

  const handleSaveWorkflow = useCallback(async () => {
    if (isReadOnly) {
      showToast('Shared workflows are read-only.', 'info');
      return;
    }
    const exportedNodes = getNodesWithParents();
    if (!auth.currentUser) {
      console.warn(
        'Cannot save to the local database: user is not authenticated. Saving locally.',
      );
      localStorage.setItem(
        'playrunner_local_workflow',
        JSON.stringify({
          nodes: exportedNodes,
          connections,
          title: workflowName,
          cloudProvider,
          concurrency,
        }),
      );
      showToast('Saved locally (Not signed in)', 'info');
      return;
    }
    setIsSaving(true);
    try {
      await DbAPI.saveWorkflow(auth.currentUser.uid, activeWorkflowId, {
        nodes: exportedNodes,
        connections,
        title: workflowName,
        cloudProvider,
        concurrency,
      });
      showToast('Workflow saved', 'success');
    } catch (err) {
      console.error('Failed to save workflow:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      appendOrchestratorLog(`Failed to save workflow: ${message}`, 'Error');
      showToast('Failed to save workflow. Open Logs for details.', 'error');
    }
    setIsSaving(false);
  }, [
    appendOrchestratorLog,
    getNodesWithParents,
    activeWorkflowId,
    connections,
    workflowName,
    cloudProvider,
    concurrency,
    isReadOnly,
  ]);

  useEffect(() => {
    if (shouldAutoSave && !isReadOnly) {
      const timer = setTimeout(() => {
        handleSaveWorkflow();
        setShouldAutoSave(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [nodes, shouldAutoSave, handleSaveWorkflow, isReadOnly]);

  const handleCloudProviderChange = useCallback(
    (nextProvider: string) => {
      clearWorkflowStartupStatus();
      setCloudProvider(nextProvider);
      localStorage.setItem('primaryCloud', nextProvider);
      if (nextProvider === 'LOCAL_RUNNER') {
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            if (node.nodeType !== 'schedule' || !node.config?.schedule) {
              return node;
            }

            return {
              ...node,
              config: {
                ...node.config,
                schedule: {
                  ...node.config.schedule,
                  enabled: false,
                },
              },
            };
          }),
        );
      }
      setShouldAutoSave(true);
    },
    [clearWorkflowStartupStatus],
  );

  const handleStop = useCallback(() => {
    isSimulationRunning.current = false;
    setSimulationState('idle');
    setNodeStatus({});
    clearWorkflowStartupStatus();
  }, [clearWorkflowStartupStatus]);

  const requestNodeDeletion = useCallback(
    (nodeIds: Iterable<string>, connectionIds: Iterable<string> = []) => {
      const uniqueNodeIds = Array.from(new Set(nodeIds));
      if (uniqueNodeIds.length === 0) return;

      setPendingNodeDeletion({
        nodeIds: uniqueNodeIds,
        connectionIds: Array.from(new Set(connectionIds)),
      });
    },
    [],
  );

  const confirmNodeDeletion = useCallback(() => {
    if (!pendingNodeDeletion) return;

    const nodeIds = new Set(pendingNodeDeletion.nodeIds);
    const connectionIds = new Set(pendingNodeDeletion.connectionIds);
    setNodes((currentNodes) =>
      currentNodes.filter((node) => !nodeIds.has(node.id)),
    );
    setConnections((currentConnections) =>
      currentConnections.filter(
        (connection) =>
          !connectionIds.has(connection.id) &&
          !nodeIds.has(connection.sourceId) &&
          !nodeIds.has(connection.targetId),
      ),
    );
    setSelectedNodeIds(new Set());
    setSelectedConnectionIds(new Set());
    setPendingNodeDeletion(null);
  }, [pendingNodeDeletion]);

  // Add keyboard listeners for deletion and saving
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      // Handle Save (Cmd+S or Ctrl+S)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveWorkflow();
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (pendingNodeDeletion) return;

        if (selectedNodeIds.size > 0) {
          requestNodeDeletion(selectedNodeIds, selectedConnectionIds);
          return;
        }

        setConnections((prev) =>
          prev.filter((c) => !selectedConnectionIds.has(c.id)),
        );
        setSelectedConnectionIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedNodeIds,
    selectedConnectionIds,
    pendingNodeDeletion,
    handleSaveWorkflow,
    requestNodeDeletion,
  ]);

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = (sx: number, sy: number) => {
    let offsetX = 0;
    let offsetY = 0;
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      offsetX = rect.left;
      offsetY = rect.top;
    }
    return {
      x: (sx - offsetX - transformRef.current.x) / transformRef.current.scale,
      y: (sy - offsetY - transformRef.current.y) / transformRef.current.scale,
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setContextMenu(null);
    // If clicking on a node, don't pan. Let node handle it.
    if (
      (e.target as Element).closest('.guard-node') ||
      (e.target as Element).closest('.guard-port')
    ) {
      return;
    }

    // If clicking on a connection SVG, let it handle it.
    if ((e.target as Element).closest('path.guard-connection')) {
      return;
    }

    // Otherwise, start panning and Clear selections
    setIsPanning(true);
    setSelectedNodeIds(new Set());
    setSelectedConnectionIds(new Set());
    lastPanPos.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });

    if (isPanning) {
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
      lastPanPos.current = { x: e.clientX, y: e.clientY };
    } else if (isDraggingNode) {
      const dx = (e.clientX - lastNodeDragPos.current.x) / transform.scale;
      const dy = (e.clientY - lastNodeDragPos.current.y) / transform.scale;

      setNodes((prev) =>
        prev.map((n) =>
          selectedNodeIds.has(n.id) || n.id === isDraggingNode
            ? { ...n, x: n.x + dx, y: n.y + dy }
            : n,
        ),
      );
      lastNodeDragPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsPanning(false);
    setIsDraggingNode(null);
    if (isDrawingConnection) {
      const pos = screenToCanvas(e.clientX, e.clientY);
      setNodeSelectorPos({ x: pos.x - 64, y: pos.y - 64 });
      setPendingConnectionSource(isDrawingConnection);
      setShowNodeSelector(true);
      setIsDrawingConnection(null);
    }
    const target = e.target as Element;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Zoom sensitivity adjustment for trackpads vs mouse wheels
    const zoomSensitivity = e.ctrlKey ? 0.01 : 0.005;
    const delta = -e.deltaY * zoomSensitivity;
    const newScale = Math.min(Math.max(transform.scale * (1 + delta), 0.1), 3);

    // Zoom around cursor
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const xs = (mouseX - transform.x) / transform.scale;
      const ys = (mouseY - transform.y) / transform.scale;

      setTransform({
        x: mouseX - xs * newScale,
        y: mouseY - ys * newScale,
        scale: newScale,
      });
    }
  };

  const handleNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();

    // Manage selection
    if (!e.shiftKey) {
      if (!selectedNodeIds.has(id)) {
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionIds(new Set());
      }
    } else {
      const newSelections = new Set(selectedNodeIds);
      if (newSelections.has(id)) newSelections.delete(id);
      else newSelections.add(id);
      setSelectedNodeIds(newSelections);
    }

    setIsDraggingNode(id);
    lastNodeDragPos.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePortPointerDown = (
    e: React.PointerEvent,
    nodeId: string,
    portPos: PortPosition,
  ) => {
    e.stopPropagation();
    setPendingAttachmentKind(null);

    // Check if this port is a target of any connection (incoming)
    let incomingConnectionIndex = -1;
    for (let index = connections.length - 1; index >= 0; index -= 1) {
      const connection = connections[index];
      if (
        connection.targetId === nodeId &&
        (connection.targetPort || 'left') === portPos
      ) {
        incomingConnectionIndex = index;
        break;
      }
    }

    if (incomingConnectionIndex !== -1) {
      const conn = connections[incomingConnectionIndex];
      const newConnections = [...connections];
      newConnections.splice(incomingConnectionIndex, 1);
      setConnections(newConnections);

      setIsDrawingConnection({
        fixedNodeId: conn.sourceId,
        fixedPort: conn.sourcePort || 'right',
        isForward: true,
      });
      return;
    }

    // Start a new connection from this port
    setIsDrawingConnection({
      fixedNodeId: nodeId,
      fixedPort: portPos,
      isForward: true,
    });
  };

  const handlePortPointerUp = (
    e: React.PointerEvent,
    targetNodeId: string,
    portPos: PortPosition,
  ) => {
    e.stopPropagation();
    if (
      isDrawingConnection &&
      isDrawingConnection.fixedNodeId !== targetNodeId
    ) {
      const sourceId = isDrawingConnection.isForward
        ? isDrawingConnection.fixedNodeId
        : targetNodeId;
      const targetId = isDrawingConnection.isForward
        ? targetNodeId
        : isDrawingConnection.fixedNodeId;
      const targetNode = nodes.find((node) => node.id === targetId);
      const sourceNode = nodes.find((node) => node.id === sourceId);

      if (!sourceNode || !targetNode) {
        setIsDrawingConnection(null);
        return;
      }

      const newConnection = createCanvasConnection(
        sourceNode,
        targetNode,
        isDrawingConnection.isForward ? isDrawingConnection.fixedPort : portPos,
        isDrawingConnection.isForward ? portPos : isDrawingConnection.fixedPort,
      );
      if (newConnection) {
        setConnections((prev) => [...prev, newConnection]);
      }
    }
    setIsDrawingConnection(null);
  };

  const handleConnectionClick = (e: ReactMouseEvent, id: string) => {
    e.stopPropagation();
    if (!e.shiftKey) {
      setSelectedConnectionIds(new Set([id]));
      setSelectedNodeIds(new Set());
    } else {
      const newSel = new Set(selectedConnectionIds);
      if (newSel.has(id)) newSel.delete(id);
      else newSel.add(id);
      setSelectedConnectionIds(newSel);
    }
  };

  const handleNodeContextMenu = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  };

  // Toolbar Actions
  const handleAddNode = useCallback(() => {
    const center = screenToCanvas(
      window.innerWidth / 2,
      window.innerHeight / 2,
    );
    setNodeSelectorPos({ x: center.x - 80, y: center.y - 40 });
    setPendingConnectionSource(null);
    setPendingAttachmentKind(null);
    setShowNodeSelector(true);
  }, []);

  const handleNodeConfigChange = (
    nodeId: string,
    newConfig: Record<string, any>,
  ) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, config: newConfig } : n)),
    );
    setShouldAutoSave(true);
  };

  const handleNodeLabelChange = (nodeId: string, newLabel: string) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, label: newLabel } : n)),
    );
    setShouldAutoSave(true);
  };

  const handleAddNodeFromSelector = (data: {
    typeId: string;
    label: string;
  }) => {
    const pos =
      nodeSelectorPos ||
      screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
    const createdAt = Date.now();
    const newNode: NodeData = {
      id: `n_${createdAt}`,
      nodeType: data.typeId,
      label: data.label,
      x:
        data.typeId === 'agent-container' && !pendingConnectionSource
          ? pos.x - (AI_CONTAINER_WIDTH - 128) / 2
          : pos.x,
      y:
        data.typeId === 'agent-container' && !pendingConnectionSource
          ? pos.y - (AI_CONTAINER_HEIGHT - 128) / 2
          : pos.y,
      width: data.typeId === 'agent-container' ? AI_CONTAINER_WIDTH : 128,
      height: data.typeId === 'agent-container' ? AI_CONTAINER_HEIGHT : 128,
      ...(pendingAttachmentKind === 'tool' &&
      (data.typeId === 'github' || data.typeId === 'jira')
        ? { config: { action: 'read' } }
        : {}),
    };

    const defaultMemoryNode: NodeData | null =
      data.typeId === 'agent-container'
        ? {
            id: `memory_${createdAt}`,
            nodeType: 'project-memory',
            label: 'Project Memory',
            x: newNode.x + AI_CONTAINER_WIDTH * 0.5 - 64,
            y: newNode.y + AI_CONTAINER_HEIGHT + 104,
            width: 128,
            height: 128,
            config: { namespace: 'project', scope: 'project' },
          }
        : null;

    setNodes((prev) => [
      ...prev,
      newNode,
      ...(defaultMemoryNode ? [defaultMemoryNode] : []),
    ]);
    if (defaultMemoryNode) {
      setConnections((previous) => [
        ...previous,
        {
          id: `c_memory_${createdAt}`,
          sourceId: defaultMemoryNode.id,
          sourcePort: 'top',
          targetId: newNode.id,
          targetPort: 'bottom',
          role: 'attachment',
          attachmentPort: 'memory',
        },
      ]);
    }

    if (pendingConnectionSource && pendingAttachmentKind) {
      const targetNode = nodes.find(
        (node) => node.id === pendingConnectionSource.fixedNodeId,
      );
      if (targetNode) {
        setConnections((previous) => [
          ...previous,
          {
            id: `c_${Date.now()}`,
            sourceId: newNode.id,
            sourcePort: 'top',
            targetId: targetNode.id,
            targetPort: 'bottom',
            role: 'attachment',
            attachmentPort: pendingAttachmentKind,
          },
        ]);
      }
    } else if (pendingConnectionSource) {
      const fixedNode = nodes.find(
        (node) => node.id === pendingConnectionSource.fixedNodeId,
      );
      if (fixedNode) {
        const sourceNode = pendingConnectionSource.isForward
          ? fixedNode
          : newNode;
        const targetNode = pendingConnectionSource.isForward
          ? newNode
          : fixedNode;
        const newConnection = createCanvasConnection(
          sourceNode,
          targetNode,
          pendingConnectionSource.isForward
            ? pendingConnectionSource.fixedPort
            : 'right',
          pendingConnectionSource.isForward
            ? 'left'
            : pendingConnectionSource.fixedPort,
        );
        if (newConnection) setConnections((prev) => [...prev, newConnection]);
      }
    }

    setSelectedNodeIds(new Set([newNode.id]));
    setSelectedConnectionIds(new Set());

    setShowNodeSelector(false);
    setNodeSelectorPos(null);
    setPendingConnectionSource(null);
    setPendingAttachmentKind(null);
    if (
      pendingAttachmentKind &&
      pendingConnectionSource &&
      !connections.some(
        (connection) =>
          connection.role === 'attachment' &&
          connection.targetId === pendingConnectionSource.fixedNodeId,
      )
    ) {
      setTransform((current) => ({
        ...current,
        y: current.y - 168 * current.scale,
      }));
    }
  };

  const handleAddAttachment = (
    node: NodeData,
    attachmentKind: AttachmentKind,
  ) => {
    const dimensions = getNodeDimensions(node);
    const horizontalRatio =
      attachmentKind === 'agent'
        ? 0.18
        : attachmentKind === 'memory'
          ? 0.5
          : 0.82;
    setPendingConnectionSource({
      fixedNodeId: node.id,
      fixedPort: 'bottom',
      isForward: true,
    });
    setPendingAttachmentKind(attachmentKind);
    setNodeSelectorPos({
      x: node.x + dimensions.width * horizontalRatio - 64,
      y: node.y + dimensions.height + 104,
    });
    setShowNodeSelector(true);
  };

  const handleFitView = () => {
    if (nodes.length === 0) {
      setTransform({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        scale: 1,
      });
      return;
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    nodes.forEach((n) => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    });

    const padding = 100;
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    const bw = maxX - minX;
    const bh = maxY - minY;

    const scaleX = (cw - padding * 2) / bw;
    const scaleY = (ch - padding * 2) / bh;
    const newScale = Math.min(scaleX, scaleY, 2); // limit max scale

    const cx = minX + bw / 2;
    const cy = minY + bh / 2;

    setTransform({
      x: cw / 2 - cx * newScale,
      y: ch / 2 - cy * newScale,
      scale: newScale,
    });
  };

  const handleZoomIn = () => {
    setTransform((t) => {
      const newScale = Math.min(t.scale * 1.25, 3);
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      return {
        x: cx - (cx - t.x) * (newScale / t.scale),
        y: cy - (cy - t.y) * (newScale / t.scale),
        scale: newScale,
      };
    });
  };

  const handleZoomOut = () => {
    setTransform((t) => {
      const newScale = Math.max(t.scale / 1.25, 0.1);
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      return {
        x: cx - (cx - t.x) * (newScale / t.scale),
        y: cy - (cy - t.y) * (newScale / t.scale),
        scale: newScale,
      };
    });
  };

  const handleAutoArrange = () => {
    if (nodes.length === 0) return;

    const NODE_GAP_X = 200;
    const NODE_GAP_Y = 60;
    const START_X = 100;
    const START_Y = 100;

    // Build adjacency: which nodes does each node feed into?
    const childrenOf = new Map<string, string[]>();
    const parentCount = new Map<string, number>();
    nodes.forEach((n) => {
      childrenOf.set(n.id, []);
      parentCount.set(n.id, 0);
    });
    connections.forEach((c) => {
      childrenOf.get(c.sourceId)?.push(c.targetId);
      parentCount.set(c.targetId, (parentCount.get(c.targetId) || 0) + 1);
    });

    // Topological sort into layers (BFS / Kahn's algorithm)
    const layers: string[][] = [];
    const assigned = new Set<string>();
    let currentLayer = nodes
      .filter(
        (n) =>
          (parentCount.get(n.id) || 0) === 0 &&
          connections.some((c) => c.sourceId === n.id || c.targetId === n.id),
      )
      .map((n) => n.id);

    // Separate unconnected (island) nodes
    const connectedIds = new Set<string>();
    connections.forEach((c) => {
      connectedIds.add(c.sourceId);
      connectedIds.add(c.targetId);
    });
    const islandNodes = nodes.filter((n) => !connectedIds.has(n.id));

    while (currentLayer.length > 0) {
      layers.push(currentLayer);
      currentLayer.forEach((id) => assigned.add(id));
      const nextLayer: string[] = [];
      for (const id of currentLayer) {
        for (const childId of childrenOf.get(id) || []) {
          if (!assigned.has(childId) && !nextLayer.includes(childId)) {
            // Check all parents are assigned
            const allParentsAssigned = connections
              .filter((c) => c.targetId === childId)
              .every((c) => assigned.has(c.sourceId));
            if (allParentsAssigned) {
              nextLayer.push(childId);
            }
          }
        }
      }
      currentLayer = nextLayer;
    }

    // Any connected nodes missed (cycles etc.) — add them
    nodes.forEach((n) => {
      if (!assigned.has(n.id) && connectedIds.has(n.id)) {
        if (layers.length === 0) layers.push([]);
        layers[layers.length - 1].push(n.id);
      }
    });

    // Position connected nodes in a grid by layer
    const newPositions = new Map<string, { x: number; y: number }>();
    layers.forEach((layer, colIdx) => {
      const totalHeight = layer.length * 128 + (layer.length - 1) * NODE_GAP_Y;
      const startY =
        START_Y +
        (layers.reduce((max, l) => Math.max(max, l.length), 0) *
          (128 + NODE_GAP_Y) -
          NODE_GAP_Y) /
          2 -
        totalHeight / 2;
      layer.forEach((nodeId, rowIdx) => {
        newPositions.set(nodeId, {
          x: START_X + colIdx * (128 + NODE_GAP_X),
          y: startY + rowIdx * (128 + NODE_GAP_Y),
        });
      });
    });

    // Position island nodes in a row below the graph
    if (islandNodes.length > 0) {
      const graphBottom =
        layers.length > 0
          ? Math.max(...Array.from(newPositions.values()).map((p) => p.y)) +
            128 +
            NODE_GAP_Y * 2
          : START_Y;
      islandNodes.forEach((n, idx) => {
        newPositions.set(n.id, {
          x: START_X + idx * (128 + NODE_GAP_X / 2),
          y: graphBottom,
        });
      });
    }

    const attachmentIndexByTarget = new Map<string, number>();
    connections
      .filter((connection) => connection.role === 'attachment')
      .forEach((connection) => {
        const target = nodes.find((node) => node.id === connection.targetId);
        if (!target) return;
        const targetPosition = newPositions.get(target.id) || {
          x: target.x,
          y: target.y,
        };
        const dimensions = getNodeDimensions(target);
        const toolIndex = attachmentIndexByTarget.get(target.id) || 0;
        const isTool = connection.attachmentPort === 'tool';
        const ratio =
          connection.attachmentPort === 'agent'
            ? 0.18
            : connection.attachmentPort === 'memory'
              ? 0.5
              : 0.82;
        newPositions.set(connection.sourceId, {
          x:
            targetPosition.x +
            dimensions.width * ratio -
            64 +
            (isTool ? toolIndex * 144 : 0),
          y: targetPosition.y + dimensions.height + 104,
        });
        if (isTool) attachmentIndexByTarget.set(target.id, toolIndex + 1);
      });

    setNodes((prev) =>
      prev.map((n) => {
        const pos = newPositions.get(n.id);
        return pos ? { ...n, x: pos.x, y: pos.y } : n;
      }),
    );

    // Auto-fit after arrange
    setTimeout(handleFitView, 50);
  };

  const getPortCoordinates = (
    node: NodeData,
    port: PortPosition,
    offset: number = 0,
  ) => {
    const dimensions = getNodeDimensions(node);
    switch (port) {
      case 'top':
        return { x: node.x + dimensions.width / 2, y: node.y - offset };
      case 'right':
        return {
          x: node.x + dimensions.width + offset,
          y: node.y + dimensions.height / 2,
        };
      case 'bottom':
        return {
          x: node.x + dimensions.width / 2,
          y: node.y + dimensions.height + offset,
        };
      case 'left':
        return { x: node.x - offset, y: node.y + dimensions.height / 2 };
    }
  };

  const getAttachmentPortCoordinates = (
    node: NodeData,
    attachmentKind: AttachmentKind,
    offset = 0,
  ) => {
    const dimensions = getNodeDimensions(node);
    const ratio =
      attachmentKind === 'agent'
        ? 0.18
        : attachmentKind === 'memory'
          ? 0.5
          : 0.82;
    return {
      x: node.x + dimensions.width * ratio,
      y: node.y + dimensions.height + offset,
    };
  };

  const getOppositePort = (port: PortPosition): PortPosition => {
    switch (port) {
      case 'top':
        return 'bottom';
      case 'bottom':
        return 'top';
      case 'left':
        return 'right';
      case 'right':
        return 'left';
    }
  };

  // Helper context to render curves
  const renderCurve = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    sourcePort: PortPosition,
    targetPort: PortPosition,
    style: 'step' | 'bezier',
  ) => {
    if (style === 'step') {
      const offset = 32;
      const getOffsetPt = (x: number, y: number, port: PortPosition) => {
        switch (port) {
          case 'top':
            return { x, y: y - offset };
          case 'bottom':
            return { x, y: y + offset };
          case 'left':
            return { x: x - offset, y };
          case 'right':
            return { x: x + offset, y };
        }
      };

      const p0 = { x: x1, y: y1 };
      const p4 = { x: x2, y: y2 };
      const p1 = getOffsetPt(x1, y1, sourcePort);
      const p3 = getOffsetPt(x2, y2, targetPort);

      const isHorizontal = (port: PortPosition) =>
        port === 'left' || port === 'right';
      const isVertical = (port: PortPosition) =>
        port === 'top' || port === 'bottom';

      let points = [p0];

      if (isHorizontal(sourcePort) && isHorizontal(targetPort)) {
        if (sourcePort === targetPort) {
          const outerX =
            sourcePort === 'left' ? Math.min(p1.x, p3.x) : Math.max(p1.x, p3.x);
          points.push({ x: outerX, y: p1.y });
          points.push({ x: outerX, y: p3.y });
        } else {
          const midX = (p1.x + p3.x) / 2;
          points.push(p1);
          points.push({ x: midX, y: p1.y });
          points.push({ x: midX, y: p3.y });
          points.push(p3);
        }
      } else if (isVertical(sourcePort) && isVertical(targetPort)) {
        const midY = (p1.y + p3.y) / 2;
        points.push(p1);
        points.push({ x: p1.x, y: midY });
        points.push({ x: p3.x, y: midY });
        points.push(p3);
      } else if (isHorizontal(sourcePort) && isVertical(targetPort)) {
        // Just one corner to connect horizontal out to vertical in
        points.push(p1);
        points.push({ x: p4.x, y: p1.y });
      } else if (isVertical(sourcePort) && isHorizontal(targetPort)) {
        // Just one corner to connect vertical out to horizontal in
        points.push(p1);
        points.push({ x: p1.x, y: p4.y });
      }
      points.push(p4);

      // Clean up duplicate points
      points = points.filter((p, i, arr) => {
        if (i === 0) return true;
        const prev = arr[i - 1];
        return Math.abs(p.x - prev.x) > 1 || Math.abs(p.y - prev.y) > 1;
      });

      // Build path with rounded corners
      let path = `M ${points[0].x} ${points[0].y}`;
      const radius = 16;

      for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const next = points[i + 1];

        const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);

        const r = Math.min(radius, dPrev / 2, dNext / 2);

        if (r < 1) {
          path += ` L ${curr.x} ${curr.y}`;
          continue;
        }

        const startX = curr.x - (r * (curr.x - prev.x)) / dPrev;
        const startY = curr.y - (r * (curr.y - prev.y)) / dPrev;

        const endX = curr.x + (r * (next.x - curr.x)) / dNext;
        const endY = curr.y + (r * (next.y - curr.y)) / dNext;

        path += ` L ${startX} ${startY}`;
        path += ` Q ${curr.x} ${curr.y} ${endX} ${endY}`;
      }

      const last = points[points.length - 1];
      path += ` L ${last.x} ${last.y}`;

      return path;
    }

    const getControlPoint = (x: number, y: number, port: PortPosition) => {
      const offset = 80;
      switch (port) {
        case 'top':
          return { x, y: y - offset };
        case 'bottom':
          return { x, y: y + offset };
        case 'left':
          return { x: x - offset, y };
        case 'right':
          return { x: x + offset, y };
      }
    };

    const cp1 = getControlPoint(x1, y1, sourcePort);
    const cp2 = getControlPoint(x2, y2, targetPort);

    return `M ${x1} ${y1} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${x2} ${y2}`;
  };

  const getCurveMidpoint = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    sourcePort: PortPosition,
    targetPort: PortPosition,
    style: 'step' | 'bezier',
  ) => {
    if (style === 'step') {
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    }

    const getControlPoint = (x: number, y: number, port: PortPosition) => {
      const offset = 80;
      switch (port) {
        case 'top':
          return { x, y: y - offset };
        case 'bottom':
          return { x, y: y + offset };
        case 'left':
          return { x: x - offset, y };
        case 'right':
          return { x: x + offset, y };
      }
    };

    const cp1 = getControlPoint(x1, y1, sourcePort);
    const cp2 = getControlPoint(x2, y2, targetPort);

    return {
      x: (x1 + 3 * cp1.x + 3 * cp2.x + x2) / 8,
      y: (y1 + 3 * cp1.y + 3 * cp2.y + y2) / 8,
    };
  };

  const renderNodeIcon = (nodeTypeId: string) => {
    const nodeType = NODE_TYPES.find((n) => n.id === nodeTypeId);
    if (nodeType) {
      if (nodeType.iconSrc) {
        if (nodeType.iconRenderMode === 'mask') {
          return (
            <div
              className="w-16 h-16 bg-current pointer-events-none"
              style={{
                WebkitMaskImage: `url(${nodeType.iconSrc})`,
                WebkitMaskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskImage: `url(${nodeType.iconSrc})`,
                maskSize: 'contain',
                maskRepeat: 'no-repeat',
                maskPosition: 'center',
              }}
            />
          );
        }
        return (
          <img
            src={nodeType.iconSrc}
            alt={nodeTypeId}
            className="w-16 h-16 object-contain pointer-events-none"
          />
        );
      }
      if (nodeType.fallbackIcon) {
        const Icon = nodeType.fallbackIcon;
        return (
          <Icon
            className={cn('w-16 h-16 pointer-events-none', nodeType.color)}
          />
        );
      }
    }
    return (
      <span className="text-sm font-mono opacity-50 uppercase pointer-events-none">
        {nodeTypeId.substring(0, 2)}
      </span>
    );
  };

  const getConnectionTargetDisabledReason = (node: AppNodeType) => {
    if (!pendingConnectionSource?.isForward) {
      return null;
    }
    const fixedNode = nodes.find(
      (candidate) => candidate.id === pendingConnectionSource.fixedNodeId,
    );
    const fixedType = getNodeType(fixedNode?.nodeType);
    if (node.executionRole === 'attachment') {
      return node.attachmentKind &&
        fixedType?.acceptsAttachments.includes(node.attachmentKind)
        ? null
        : 'This node does not accept that attachment';
    }
    if (fixedType?.executionRole === 'attachment') {
      return fixedType.attachmentKind &&
        node.acceptsAttachments.includes(fixedType.attachmentKind)
        ? null
        : 'This node does not accept that attachment';
    }
    return node.acceptsInboundConnection ? null : 'No inbound connection';
  };

  useEffect(() => {
    setHeaderLeft(
      <>
        <button
          onClick={() =>
            navigate(projectId ? `/projects/${projectId}` : '/projects')
          }
          className="p-2 -ml-2 text-muted hover:text-[var(--foreground)] hover:bg-surface-hover rounded-lg transition-colors"
          title="Back to Project"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="h-6 w-px bg-subtle mx-2" />
        {isEditingName && !isReadOnly ? (
          <input
            autoFocus
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            onBlur={() => {
              setIsEditingName(false);
              handleSaveWorkflow();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setIsEditingName(false);
                handleSaveWorkflow();
              }
              if (e.key === 'Escape') setIsEditingName(false);
            }}
            className="bg-transparent border-b border-white/20 focus:border-white/50 outline-none text-sm font-medium text-[var(--foreground)] px-1 py-0.5 w-48 transition-colors"
          />
        ) : (
          <button
            onClick={() => {
              if (!isReadOnly) setIsEditingName(true);
            }}
            className="text-sm font-medium text-[var(--foreground)] truncate max-w-[220px] transition-colors px-1 py-0.5 rounded disabled:cursor-default"
            title={
              isReadOnly
                ? 'Shared workflow (read-only)'
                : 'Click to rename workflow'
            }
            disabled={isReadOnly}
          >
            {workflowName}
          </button>
        )}
      </>,
    );
    return () => setHeaderLeft(null);
  }, [
    projectId,
    workflowName,
    isEditingName,
    setHeaderLeft,
    navigate,
    handleSaveWorkflow,
    isReadOnly,
  ]);

  useEffect(() => {
    setHeaderCenter(
      <div className="bg-surface/30 rounded-lg p-1 flex items-center gap-2">
        <CloudProviderDropdown
          value={cloudProvider}
          onChange={(provider) => {
            if (!isReadOnly) handleCloudProviderChange(provider);
          }}
          onOpenSettings={() => {
            if (!isReadOnly) setIsCloudSettingsOpen(true);
          }}
          connectedIds={connectedCloudIds}
          cloudProjectId={cloudProjectId}
          providers={availableCloudProviders}
        />
        <div className="h-4 w-px bg-strong mx-1" />
        <button
          onClick={handleAddNode}
          className="flex items-center justify-center w-8 h-8 rounded-md text-sm font-medium text-[var(--foreground)] hover:bg-surface-hover transition-colors"
          title="Add Node"
          disabled={isReadOnly}
        >
          <Plus className="w-4 h-4 text-[var(--foreground)]" />
        </button>
        <button
          onClick={handleSaveWorkflow}
          className="flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-[var(--foreground)] hover:bg-surface-hover transition-colors disabled:opacity-50"
          title={isReadOnly ? 'Shared workflow (read-only)' : 'Save Workflow'}
          disabled={isSaving || isReadOnly}
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
        </button>
        {simulationState === 'idle' ? (
          <button
            onClick={handlePlay}
            title="Play Simulation"
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-[var(--foreground)] hover:bg-surface-hover transition-colors"
          >
            <Play className="w-4 h-4" fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleStop}
            title="Stop Simulation"
            className="relative flex items-center justify-center w-8 h-8 transition-colors text-[var(--foreground)]"
          >
            <svg
              className="absolute inset-0 w-full h-full animate-spin"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="16"
                cy="16"
                r="13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="40 42"
                className="opacity-70"
              />
            </svg>
            <Square className="w-3.5 h-3.5 relative z-10" fill="currentColor" />
          </button>
        )}
      </div>,
    );
    return () => setHeaderCenter(null);
  }, [
    cloudProjectId,
    cloudProvider,
    connectedCloudIds,
    isSaving,
    isReadOnly,
    simulationState,
    setHeaderCenter,
    handleCloudProviderChange,
    handleSaveWorkflow,
    handlePlay,
    handleStop,
    handleAddNode,
  ]);

  const workflowStartupElapsedMs = workflowStartupStatus
    ? (workflowStartupStatus.phase === 'failed'
        ? workflowStartupStatus.updatedAt
        : workflowStartupNow) - workflowStartupStatus.startedAt
    : 0;

  if (!isOrchestratorReady) {
    if (orchestratorStartError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <XCircle className="w-10 h-10 text-red-500" />
          <div className="space-y-2">
            <p className="text-lg font-medium text-[var(--foreground)]">
              Failed to start orchestrator runner
            </p>
            <p className="max-w-xl text-sm text-muted">
              {orchestratorStartError}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              setOrchestratorStartAttempt((current) => current + 1)
            }
          >
            Retry runner startup
          </Button>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <p className="text-lg font-medium">Loading orchestrator runner...</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 relative overflow-hidden select-none">
        {isReadOnly ? (
          <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-muted shadow-sm">
            <ShieldCheck className="h-4 w-4" />
            Shared via{' '}
            {workflowAccess.sharedTeams.map((team) => team.name).join(', ')}.
            You can view and run this workflow, but only its owner can edit it.
          </div>
        ) : null}
        <NodeSelectorModal
          attachmentKind={pendingAttachmentKind}
          isOpen={showNodeSelector}
          onClose={() => {
            setShowNodeSelector(false);
            setNodeSelectorPos(null);
            setPendingConnectionSource(null);
            setPendingAttachmentKind(null);
          }}
          onSelect={handleAddNodeFromSelector}
          getNodeDisabledReason={
            pendingConnectionSource
              ? getConnectionTargetDisabledReason
              : undefined
          }
        />

        <ConfirmDialog
          isOpen={!!pendingNodeDeletion}
          title={
            pendingNodeDeletion?.nodeIds.length === 1
              ? `Delete “${
                  nodes.find(
                    (node) => node.id === pendingNodeDeletion.nodeIds[0],
                  )?.label || 'node'
                }”?`
              : `Delete ${pendingNodeDeletion?.nodeIds.length || 0} nodes?`
          }
          description={
            pendingNodeDeletion?.nodeIds.length === 1
              ? 'This will permanently remove the node and all of its connections from the workflow. This action cannot be undone.'
              : 'This will permanently remove the selected nodes and all of their connections from the workflow. This action cannot be undone.'
          }
          confirmLabel={
            pendingNodeDeletion?.nodeIds.length === 1
              ? 'Delete node'
              : 'Delete nodes'
          }
          onCancel={() => setPendingNodeDeletion(null)}
          onConfirm={confirmNodeDeletion}
        />

        {ActiveCloudSettingsModal ? (
          <ActiveCloudSettingsModal
            isOpen={isCloudSettingsOpen}
            onClose={() => {
              setIsCloudSettingsOpen(false);
            }}
            cloudId={
              activeCloudProvider?.credentialId || cloudProvider.toLowerCase()
            }
          />
        ) : null}

        <Modal
          isOpen={isCodeModalOpen}
          onClose={() => setIsCodeModalOpen(false)}
          title="Workflow JSON"
          icon={<Code2 className="w-5 h-5 text-blue-400" />}
          maxWidth="max-w-2xl"
        >
          <div className="bg-[#1e1e1e] rounded-lg relative group overflow-hidden">
            <div className="absolute top-2 right-4 z-10">
              <button
                onClick={handleCopyCode}
                className="p-2 rounded-md bg-white/10 hover:bg-white/20 text-gray-300 transition-colors opacity-0 group-hover:opacity-100 backdrop-blur-sm border border-white/10"
                title="Copy JSON"
              >
                {isCopied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-auto select-text cursor-text">
              <pre className="text-sm font-mono text-gray-300">
                {JSON.stringify(
                  { nodes: getNodesWithParents(), connections, cloudProvider },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        </Modal>

        {ActiveIntegrationSettingsModal ? (
          <ActiveIntegrationSettingsModal
            isOpen={!!activeIntegrationSettingsId}
            onClose={() => setActiveIntegrationSettingsId(null)}
          />
        ) : null}

        {workflowStartupStatus ? (
          <WorkflowStartupStatusPanel
            elapsedMs={workflowStartupElapsedMs}
            status={workflowStartupStatus}
          />
        ) : null}

        {/* Mini Toolbar — top right */}
        <div className="absolute top-3 right-3 z-20 flex flex-col items-center gap-1">
          <button
            onClick={handleZoomIn}
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-[var(--foreground)] hover:bg-white/10 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <span className="text-[10px] text-muted font-mono tabular-nums select-none">
            {Math.round(transform.scale * 100)}%
          </span>
          <button
            onClick={handleZoomOut}
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-[var(--foreground)] hover:bg-white/10 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsCodeModalOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-[var(--foreground)] hover:bg-white/10 transition-colors"
            title="View JSON"
          >
            <Code2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleFitView}
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-[var(--foreground)] hover:bg-white/10 transition-colors"
            title="Fit View"
          >
            <Maximize className="w-4 h-4" />
          </button>
          <button
            onClick={() =>
              setConnectionStyle((prev) =>
                prev === 'step' ? 'bezier' : 'step',
              )
            }
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-[var(--foreground)] hover:bg-white/10 transition-colors"
            title={
              connectionStyle === 'step'
                ? 'Switch to Bezier Curves'
                : 'Switch to Step Lines'
            }
          >
            {connectionStyle === 'step' ? (
              <Route className="w-4 h-4" />
            ) : (
              <Activity className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={handleAutoArrange}
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-[var(--foreground)] hover:bg-white/10 transition-colors"
            title="Auto-arrange nodes"
          >
            <Paintbrush className="w-4 h-4" />
          </button>
        </div>

        {/* Background Grid Pattern (responsive to transform) */}
        <div
          className="absolute inset-0 z-0 pointer-events-none opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, var(--muted) 1px, transparent 0)',
            backgroundSize: `${20 * transform.scale}px ${20 * transform.scale}px`,
            backgroundPosition: `${transform.x}px ${transform.y}px`,
          }}
        />

        {/* Canvas Layer */}
        <div
          ref={canvasRef}
          className="absolute inset-0 z-10 touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          {/* Transform Group */}
          <div
            className="absolute origin-top-left"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            }}
          >
            {/* SVG Connections Overlay */}
            <svg
              className="absolute overflow-visible pointer-events-none"
              style={{ width: 1, height: 1 }}
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 6 3, 0 6" fill="var(--node-border)" />
                </marker>
                <marker
                  id="arrowhead-selected"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 6 3, 0 6" fill="var(--accent)" />
                </marker>
                <marker
                  id="arrowhead-success"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 6 3, 0 6" fill="#4ade80" />
                </marker>
                <marker
                  id="arrowhead-failure"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 6 3, 0 6" fill="#f87171" />
                </marker>
              </defs>
              {connections.map((conn) => {
                const src = nodes.find((n) => n.id === conn.sourceId);
                const tgt = nodes.find((n) => n.id === conn.targetId);
                if (!src || !tgt) return null;

                const sPort =
                  conn.role === 'attachment'
                    ? 'top'
                    : conn.sourcePort || 'right';
                const tPort =
                  conn.role === 'attachment'
                    ? 'bottom'
                    : conn.targetPort || 'left';

                const startCoords = getPortCoordinates(src, sPort);
                const endCoords =
                  conn.role === 'attachment' && conn.attachmentPort
                    ? getAttachmentPortCoordinates(tgt, conn.attachmentPort)
                    : getPortCoordinates(tgt, tPort, 10);

                const isSelected = selectedConnectionIds.has(conn.id);
                const isTargetRunning = nodeStatus[conn.targetId] === 'running';

                const strokeColor = isSelected
                  ? 'var(--accent)'
                  : conn.role === 'attachment'
                    ? 'var(--muted)'
                    : conn.type === 'success'
                      ? '#4ade80'
                      : conn.type === 'failure'
                        ? '#f87171'
                        : 'var(--node-border)';

                const strokeDasharray = isTargetRunning
                  ? '6 6'
                  : conn.role === 'attachment'
                    ? '3 5'
                    : conn.type === 'independent' || conn.type === 'concurrent'
                      ? '6 4'
                      : 'none';

                return (
                  <g
                    key={conn.id}
                    data-testid={
                      conn.role === 'attachment' && conn.attachmentPort
                        ? `canvas-attachment-${conn.attachmentPort}`
                        : undefined
                    }
                    className="pointer-events-auto guard-connection"
                    onClick={(e) => handleConnectionClick(e, conn.id)}
                    onPointerEnter={() => setHoveredConnectionId(conn.id)}
                    onPointerLeave={() => setHoveredConnectionId(null)}
                  >
                    {/* Invisible wide track for easier clicking */}
                    <path
                      d={renderCurve(
                        startCoords.x,
                        startCoords.y,
                        endCoords.x,
                        endCoords.y,
                        sPort,
                        tPort,
                        connectionStyle,
                      )}
                      stroke="transparent"
                      strokeWidth={20}
                      fill="none"
                      className="cursor-pointer"
                    />
                    {/* Visible path */}
                    <path
                      d={renderCurve(
                        startCoords.x,
                        startCoords.y,
                        endCoords.x,
                        endCoords.y,
                        sPort,
                        tPort,
                        connectionStyle,
                      )}
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 3 : 2}
                      strokeDasharray={strokeDasharray}
                      fill="none"
                      markerEnd={
                        conn.role === 'attachment'
                          ? undefined
                          : isSelected
                            ? 'url(#arrowhead-selected)'
                            : conn.type === 'success'
                              ? 'url(#arrowhead-success)'
                              : conn.type === 'failure'
                                ? 'url(#arrowhead-failure)'
                                : 'url(#arrowhead)'
                      }
                      className={cn(
                        'transition-colors drop-shadow-sm',
                        isTargetRunning && 'animate-flow',
                      )}
                    />
                  </g>
                );
              })}

              {/* Drawing connection layer */}
              {isDrawingConnection &&
                canvasRef.current &&
                (() => {
                  const fixedNode = nodes.find(
                    (n) => n.id === isDrawingConnection.fixedNodeId,
                  );
                  if (!fixedNode) return null;

                  const fixedCoordsStart = getPortCoordinates(
                    fixedNode,
                    isDrawingConnection.fixedPort,
                  );
                  const fixedCoordsEnd = getPortCoordinates(
                    fixedNode,
                    isDrawingConnection.fixedPort,
                    10,
                  );
                  const targetPt = screenToCanvas(mousePos.x, mousePos.y);

                  const startCoords = isDrawingConnection.isForward
                    ? fixedCoordsStart
                    : targetPt;
                  const endCoords = isDrawingConnection.isForward
                    ? targetPt
                    : fixedCoordsEnd;

                  const movingPort = getOppositePort(
                    isDrawingConnection.fixedPort,
                  );
                  const sPort = isDrawingConnection.isForward
                    ? isDrawingConnection.fixedPort
                    : movingPort;
                  const tPort = isDrawingConnection.isForward
                    ? movingPort
                    : isDrawingConnection.fixedPort;

                  return (
                    <path
                      d={renderCurve(
                        startCoords.x,
                        startCoords.y,
                        endCoords.x,
                        endCoords.y,
                        sPort,
                        tPort,
                        connectionStyle,
                      )}
                      stroke="var(--node-border)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      fill="none"
                      markerEnd="url(#arrowhead)"
                      className="pointer-events-none"
                    />
                  );
                })()}
            </svg>

            {/* HTML Nodes */}
            {nodes.map((node) => {
              const isSelected = selectedNodeIds.has(node.id);
              const status = nodeStatus[node.id] || 'idle';
              const runtimeChildren = Object.values(
                runtimePlaywrightChildren[node.id] || {},
              ).sort((left, right) => {
                const order = { discovery: 0, shard: 1, aggregate: 2 };
                const kindDifference =
                  order[left.childKind] - order[right.childKind];
                return kindDifference !== 0
                  ? kindDifference
                  : (left.shardIndex || 0) - (right.shardIndex || 0);
              });
              const runtimePlan = runtimePlaywrightPlans[node.id];
              const runtimeShardCount =
                runtimePlan?.count ??
                runtimeChildren.filter((child) => child.childKind === 'shard')
                  .length;
              const runtimeWorkersPerShard = runtimePlan?.workersPerShard ?? 1;
              const runtimeCpuPerShard = runtimePlan
                ? (runtimePlan.cpuPerShard ??
                  runtimePlan.aggregateCpu / runtimePlan.count)
                : null;
              const runtimeMemoryPerShard = runtimePlan
                ? (runtimePlan.memoryGbPerShard ??
                  runtimePlan.aggregateMemoryGb / runtimePlan.count)
                : null;
              const runtimePlanLimit = runtimePlan
                ? runtimePlan.limits.capacity <=
                    runtimePlan.limits.configured &&
                  runtimePlan.limits.capacity <= runtimePlan.limits.useful
                  ? 'runner capacity'
                  : runtimePlan.limits.useful <= runtimePlan.limits.configured
                    ? 'suite size'
                    : 'your maximum'
                : null;
              const isRuntimeExpanded = !!expandedRuntimeNodes[node.id];

              const isNodeConfigured = (n: NodeData) => {
                if (n.nodeType === 'environment') {
                  const vars = n.config?.variables || [];
                  return vars.some(
                    (v: any) => v.key || v.initialValue || v.currentValue,
                  );
                }
                if (n.nodeType === 'schedule') {
                  return !!n.config?.schedule?.frequency;
                }
                if (n.nodeType === 'agent-container') {
                  const attachments = connections.filter(
                    (connection) =>
                      connection.role === 'attachment' &&
                      connection.targetId === n.id,
                  );
                  return (
                    !!n.config?.repository?.trim() &&
                    !!n.config?.task?.trim() &&
                    attachments.some(
                      (connection) => connection.attachmentPort === 'agent',
                    ) &&
                    attachments.some((connection) => {
                      if (connection.attachmentPort !== 'tool') return false;
                      return (
                        nodes.find(
                          (candidate) => candidate.id === connection.sourceId,
                        )?.nodeType === 'validator'
                      );
                    })
                  );
                }
                if (!n.config) return false;
                if (n.nodeType === 'javascript-code') {
                  return !!n.config.code?.trim();
                }
                return Object.keys(n.config).length > 0;
              };

              const hasConnection = (port: PortPosition) =>
                connections.some(
                  (c) =>
                    (c.targetId === node.id &&
                      (c.targetPort || 'left') === port) ||
                    (c.sourceId === node.id &&
                      (c.sourcePort || 'right') === port),
                );

              const isScheduleNode = node.nodeType === 'schedule';
              const isEnvironmentNode = node.nodeType === 'environment';
              const isAttachmentNode =
                getNodeType(node.nodeType)?.executionRole === 'attachment' ||
                connections.some(
                  (connection) =>
                    connection.role === 'attachment' &&
                    connection.sourceId === node.id,
                );
              const isAIContainer = node.nodeType === 'agent-container';

              const renderPort = (
                port: PortPosition,
                posClass: string,
                diamond = false,
              ) => {
                const connected = hasConnection(port);
                const defaultVisible =
                  port === 'right' || (!isEnvironmentNode && port === 'left');
                const outboundChevronRotation =
                  port === 'top'
                    ? '-rotate-90'
                    : port === 'bottom'
                      ? 'rotate-90'
                      : port === 'left'
                        ? 'rotate-180'
                        : undefined;
                return (
                  <div
                    className={cn(
                      'guard-port absolute w-10 h-10 flex items-center justify-center cursor-crosshair pointer-events-auto',
                      posClass,
                    )}
                    data-connection-direction={
                      isEnvironmentNode ? 'outbound' : undefined
                    }
                    title={
                      isEnvironmentNode
                        ? `Create outbound connection from ${port}`
                        : undefined
                    }
                    onPointerDown={(e) =>
                      handlePortPointerDown(e, node.id, port)
                    }
                    onPointerUp={(e) => handlePortPointerUp(e, node.id, port)}
                  >
                    <div
                      data-testid={
                        diamond ? 'canvas-attachment-node-socket' : undefined
                      }
                      className={cn(
                        'border border-[var(--node-port-border)] bg-[var(--node-port-bg)] transition-all duration-200',
                        diamond
                          ? 'h-4 w-4 rotate-45 border-[var(--muted)]'
                          : 'h-6 w-6 rounded-full',
                        isEnvironmentNode &&
                          !diamond &&
                          'flex items-center justify-center text-muted',
                        connected || defaultVisible
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      {isEnvironmentNode && !diamond && !connected && (
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            'h-3 w-3 stroke-[2.5]',
                            outboundChevronRotation,
                          )}
                        />
                      )}
                    </div>
                  </div>
                );
              };

              const nodeDimensions = getNodeDimensions(node);
              const attachedAgentCount = connections.filter(
                (connection) =>
                  connection.role === 'attachment' &&
                  connection.targetId === node.id &&
                  connection.attachmentPort === 'agent',
              ).length;
              const attachedToolCount = connections.filter(
                (connection) =>
                  connection.role === 'attachment' &&
                  connection.targetId === node.id &&
                  connection.attachmentPort === 'tool',
              ).length;
              const attachedMemoryCount = connections.filter(
                (connection) =>
                  connection.role === 'attachment' &&
                  connection.targetId === node.id &&
                  connection.attachmentPort === 'memory',
              ).length;

              return (
                <div
                  key={node.id}
                  data-testid={`canvas-node-${node.nodeType}`}
                  data-node-id={node.id}
                  data-node-status={status}
                  className={cn(
                    'group guard-node absolute flex flex-col justify-center cursor-move select-none transition-shadow transition-colors',
                    isEnvironmentNode
                      ? 'isolate bg-transparent'
                      : 'bg-[var(--node-bg)] shadow-lg',
                    isAIContainer ? 'p-0' : 'p-4',
                    isScheduleNode
                      ? 'rounded-t-full rounded-b-lg'
                      : isAttachmentNode
                        ? 'rounded-full'
                        : !isEnvironmentNode && 'rounded-xl',
                    !isEnvironmentNode &&
                      (status === 'running' ? 'border-transparent' : 'border'),
                    !isEnvironmentNode &&
                      status !== 'running' &&
                      isSelected &&
                      'border-[var(--border-strong)] ring-[4px] ring-[var(--border-strong)] shadow-xl',
                    !isEnvironmentNode &&
                      status !== 'running' &&
                      !isSelected &&
                      'border-[var(--node-border)]',
                  )}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: isScheduleNode ? 128 : nodeDimensions.width,
                    height: isScheduleNode ? 128 : nodeDimensions.height,
                  }}
                  onPointerDown={(e) => handleNodePointerDown(e, node.id)}
                  onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                >
                  {isEnvironmentNode && (
                    <div
                      data-testid="canvas-environment-node-shape"
                      className={cn(
                        'environment-node-hexagon pointer-events-none absolute inset-0 z-[-1] overflow-hidden drop-shadow-lg',
                        status === 'running'
                          ? 'bg-transparent'
                          : isSelected
                            ? 'bg-[var(--border-strong)]'
                            : 'bg-[var(--node-border)]',
                      )}
                    >
                      {status === 'running' && (
                        <div className="absolute left-1/2 top-1/2 aspect-square w-[300%] -translate-x-1/2 -translate-y-1/2 animate-[spin_2s_linear_infinite] bg-[conic-gradient(from_0deg,#3b82f6,#22d3ee,#3b82f6)]" />
                      )}
                      <div
                        className={cn(
                          'environment-node-hexagon absolute inset-0 origin-center bg-[var(--node-bg)]',
                          status !== 'running' && isSelected
                            ? 'scale-[0.932342]'
                            : 'scale-[0.986468]',
                        )}
                      />
                    </div>
                  )}

                  {status === 'running' && !isEnvironmentNode && (
                    <div
                      className="running-border-wrapper"
                      style={
                        isScheduleNode
                          ? { borderRadius: '9999px 9999px 8px 8px' }
                          : isAttachmentNode
                            ? { borderRadius: '9999px' }
                            : undefined
                      }
                    >
                      <div className="absolute left-1/2 top-1/2 aspect-square w-[300%] -translate-x-1/2 -translate-y-1/2 animate-[spin_2s_linear_infinite] bg-[conic-gradient(from_0deg,#3b82f6,#22d3ee,#3b82f6)]" />
                    </div>
                  )}

                  {node.nodeType === 'playwright' &&
                    runtimeChildren.length > 0 && (
                      <>
                        <button
                          type="button"
                          className={cn(
                            'absolute inset-x-0 bottom-0 z-20 flex h-9 w-full items-center gap-1.5 rounded-b-xl border-t border-[var(--node-border)] bg-[var(--node-bg)] px-2 text-muted pointer-events-auto transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]',
                            isRuntimeExpanded &&
                              'bg-[var(--surface-hover)] text-[var(--foreground)]',
                          )}
                          aria-expanded={isRuntimeExpanded}
                          aria-label={`${isRuntimeExpanded ? 'Collapse' : 'Expand'} ${runtimePlan?.mode === 'auto' ? 'auto' : 'execution'} plan: ${runtimeShardCount} shards, ${runtimeWorkersPerShard} workers each`}
                          title={`${runtimePlan?.mode === 'auto' ? 'Auto plan' : 'Execution plan'}: ${runtimeShardCount} shards × ${runtimeWorkersPerShard} workers each`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedRuntimeNodes((previous) => ({
                              ...previous,
                              [node.id]: !previous[node.id],
                            }));
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <span className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-blue-400">
                            {runtimePlan?.mode === 'auto' ? 'Auto' : 'Plan'}
                          </span>
                          <span className="min-w-0 flex-1 whitespace-nowrap text-center text-[10px] font-medium text-[var(--foreground)]">
                            {runtimeShardCount} × {runtimeWorkersPerShard}
                          </span>
                          {isRuntimeExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          )}
                        </button>

                        {isRuntimeExpanded && (
                          <div
                            className="absolute left-[calc(100%+32px)] top-0 z-20 flex w-56 flex-col gap-2 pointer-events-auto"
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <div className="absolute -left-8 top-8 h-px w-8 bg-[var(--node-border)]" />
                            {runtimePlan && (
                              <div
                                className="guard-node rounded-lg border border-blue-500/40 bg-[var(--node-bg)] p-3 text-left shadow-md"
                                title={runtimePlan.reason}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-400">
                                    {runtimePlan.mode === 'auto'
                                      ? 'Auto plan selected'
                                      : 'Execution plan'}
                                  </span>
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                                </div>
                                <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                                  {runtimePlan.count} shards ×{' '}
                                  {runtimePlan.workersPerShard} workers each
                                </p>
                                <p className="mt-1 text-[10px] leading-4 text-muted">
                                  Per shard: {runtimeCpuPerShard} CPU ·{' '}
                                  {runtimeMemoryPerShard !== null &&
                                  runtimeMemoryPerShard < 1
                                    ? `${runtimeMemoryPerShard * 1024} MB`
                                    : `${runtimeMemoryPerShard} GB`}
                                </p>
                                <p className="text-[10px] leading-4 text-muted">
                                  Total: {runtimePlan.aggregateCpu} CPUs ·{' '}
                                  {runtimePlan.aggregateMemoryGb} GB ·{' '}
                                  {runtimePlan.aggregateWorkers} workers
                                </p>
                                <div className="my-2 h-px bg-[var(--node-border)]" />
                                <p className="text-[10px] leading-4 text-muted">
                                  {runtimePlan.discovery.testCount} tests in{' '}
                                  {runtimePlan.discovery.fileCount} files
                                </p>
                                <p className="text-[10px] leading-4 text-muted">
                                  {runtimePlan.estimate?.source === 'history'
                                    ? `Based on ${runtimePlan.estimate.historySamples} comparable previous run${runtimePlan.estimate.historySamples === 1 ? '' : 's'}`
                                    : 'No comparable history: using a safe discovery-based estimate'}
                                  {runtimePlan.estimate?.durationMs != null
                                    ? ` · expected ${formatPlannedDuration(runtimePlan.estimate.durationMs)}`
                                    : ''}
                                </p>
                                <p className="text-[10px] leading-4 text-muted">
                                  {runtimePlan.estimate?.source === 'history' &&
                                  runtimePlan.count <
                                    Math.min(
                                      runtimePlan.limits.capacity,
                                      runtimePlan.limits.configured,
                                      runtimePlan.limits.useful,
                                    )
                                    ? `History optimized the shape to ${runtimePlan.count} shards.`
                                    : `Limited by ${runtimePlanLimit} (${runtimePlan.count}).`}
                                </p>
                                <p className="text-[10px] leading-4 text-muted">
                                  Limits: max {runtimePlan.limits.configured} ·
                                  suite {runtimePlan.limits.useful} · capacity{' '}
                                  {runtimePlan.limits.capacity}
                                </p>
                              </div>
                            )}
                            {runtimeChildren.map((child) => {
                              const label =
                                child.childKind === 'shard'
                                  ? `Shard ${child.shardIndex}/${child.shardTotal}`
                                  : child.childKind === 'aggregate'
                                    ? 'Merge reports'
                                    : 'Discover tests';
                              return (
                                <button
                                  key={child.id}
                                  type="button"
                                  className="guard-node relative flex items-center gap-2 rounded-lg border border-[var(--node-border)] bg-[var(--node-bg)] px-3 py-2 text-left shadow-md hover:border-[var(--border-strong)]"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedRuntimeChildId(child.id);
                                  }}
                                >
                                  {child.status === 'running' && (
                                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-400" />
                                  )}
                                  {child.status === 'pending' && (
                                    <Clock className="h-4 w-4 shrink-0 animate-pulse text-sky-300" />
                                  )}
                                  {child.status === 'success' && (
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                                  )}
                                  {child.status === 'error' && (
                                    <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                                  )}
                                  <span className="min-w-0">
                                    <span className="block truncate text-xs font-semibold text-[var(--foreground)]">
                                      {label}
                                    </span>
                                    <span className="block truncate text-[10px] capitalize text-muted">
                                      {child.status}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}

                  {/* Connection Placeholder (hidden for schedule nodes) */}
                  {!isScheduleNode &&
                    !isAttachmentNode &&
                    !connections.some(
                      (c) =>
                        c.sourceId === node.id &&
                        (c.sourcePort === 'right' || !c.sourcePort),
                    ) && (
                      <div className="absolute top-1/2 -translate-y-1/2 left-full flex items-center z-[-1]">
                        <div className="w-[40px] h-[2px] shrink-0 bg-[var(--node-border)]" />
                        <button
                          className="group/add-node relative w-6 h-6 rounded-md bg-[var(--node-bg)] hover:bg-surface-hover dark:hover:bg-[#3f3f46] flex items-center justify-center transition-colors text-muted hover:text-[var(--foreground)] shadow-sm pointer-events-auto"
                          aria-label="Add connected node"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingConnectionSource({
                              fixedNodeId: node.id,
                              fixedPort: 'right',
                              isForward: true,
                            });
                            setNodeSelectorPos({
                              x: node.x + nodeDimensions.width + 80,
                              y: node.y,
                            });
                            setPendingAttachmentKind(null);
                            setShowNodeSelector(true);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <Plus className="w-4 h-4" />
                          <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded border border-subtle bg-surface-hover px-2 py-1 text-xs font-medium text-[var(--foreground)] dark:border-[#555] dark:bg-[#555] dark:text-white opacity-0 shadow-lg transition-opacity group-hover/add-node:opacity-100">
                            Add connected node
                          </span>
                        </button>
                      </div>
                    )}

                  {/* Ports (hidden for schedule nodes) */}
                  {!isScheduleNode &&
                    renderPort(
                      'top',
                      '-top-5 left-1/2 -translate-x-1/2',
                      isAttachmentNode,
                    )}
                  {!isScheduleNode &&
                    !isAttachmentNode &&
                    renderPort('right', '-right-5 top-1/2 -translate-y-1/2')}
                  {!isScheduleNode &&
                    !isAIContainer &&
                    !isAttachmentNode &&
                    renderPort('bottom', '-bottom-5 left-1/2 -translate-x-1/2')}
                  {!isScheduleNode &&
                    !isAttachmentNode &&
                    renderPort('left', '-left-5 top-1/2 -translate-y-1/2')}

                  {/* Label & Icon */}
                  {isAIContainer ? (
                    <div className="relative flex h-full w-full flex-col pointer-events-none">
                      <div className="flex min-h-0 flex-1 items-center gap-4 px-8 pb-12">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[var(--node-border)] bg-[var(--surface-hover)]">
                          <div className="scale-75">
                            {renderNodeIcon(node.nodeType)}
                          </div>
                        </div>
                        <div className="min-w-0 text-left">
                          <p className="truncate text-base font-semibold text-[var(--foreground)]">
                            {node.label}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">
                            Coding Agent
                          </p>
                        </div>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 h-12">
                        {(
                          [
                            {
                              kind: 'agent' as const,
                              label: 'Agent',
                              count: attachedAgentCount,
                              ratio: 0.18,
                            },
                            {
                              kind: 'memory' as const,
                              label: 'Memory',
                              count: attachedMemoryCount,
                              ratio: 0.5,
                            },
                            {
                              kind: 'tool' as const,
                              label: 'Tools',
                              count: attachedToolCount,
                              ratio: 0.82,
                            },
                          ] as const
                        ).map((attachment) => (
                          <div
                            key={attachment.kind}
                            className="absolute inset-y-0 flex -translate-x-1/2 flex-col items-center justify-center"
                            style={{ left: `${attachment.ratio * 100}%` }}
                          >
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                              {attachment.label}
                            </span>
                            <span
                              data-testid={`agent-container-${attachment.kind}-socket`}
                              className="absolute -bottom-2 h-4 w-4 rotate-45 border border-[var(--muted)] bg-[var(--node-port-bg)] shadow-sm"
                            />
                            {(attachment.kind === 'tool' ||
                              attachment.count === 0) && (
                              <>
                                <span
                                  data-testid={`agent-container-add-${attachment.kind}-stem`}
                                  className="absolute top-[calc(100%+12px)] h-2 w-px bg-[var(--muted)]"
                                />
                                <button
                                  type="button"
                                  data-testid={`agent-container-add-${attachment.kind}`}
                                  aria-label={`Add ${attachment.label}`}
                                  title={`Add ${attachment.label}`}
                                  className="absolute top-[calc(100%+20px)] flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--node-border)] bg-[var(--node-bg)] text-muted shadow-sm pointer-events-auto transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleAddAttachment(node, attachment.kind);
                                  }}
                                  onPointerDown={(event) =>
                                    event.stopPropagation()
                                  }
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'flex items-center justify-center w-full h-full relative pointer-events-none',
                        node.nodeType === 'playwright' &&
                          runtimeChildren.length > 0 &&
                          'pb-8',
                      )}
                    >
                      <div className="w-16 h-16 rounded-lg flex items-center justify-center shrink-0">
                        {renderNodeIcon(node.nodeType)}
                      </div>
                    </div>
                  )}

                  {!isNodeConfigured(node) &&
                    status !== 'pending' &&
                    status !== 'running' &&
                    status !== 'success' &&
                    status !== 'error' &&
                    status !== 'warning' && (
                      <button
                        className="absolute bottom-1 right-1 flex items-center justify-center text-amber-500 pointer-events-auto transition-transform hover:scale-110 drop-shadow-sm group/alert"
                        title="Node not fully configured. Click to setup."
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenNodeSettingsId(node.id);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <AlertTriangle className="w-6 h-6 fill-amber-500 stroke-[var(--node-bg)] stroke-[1.5]" />
                      </button>
                    )}

                  {status === 'running' && (
                    <div className="absolute top-2 right-2 flex items-center justify-center text-blue-400 z-10 drop-shadow-sm">
                      <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                  )}
                  {status === 'pending' && (
                    <div
                      className="absolute top-2 right-2 flex items-center justify-center text-sky-300 z-10 drop-shadow-sm"
                      title="Playwright runner starting"
                    >
                      <Clock className="w-5 h-5 animate-pulse" />
                    </div>
                  )}
                  {status === 'success' && (
                    <div className="absolute top-2 right-2 flex items-center justify-center text-emerald-400 z-10 drop-shadow-sm">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                  )}
                  {status === 'error' && (
                    <div className="absolute top-2 right-2 flex items-center justify-center text-red-500 z-10 drop-shadow-sm">
                      <XCircle className="w-5 h-5" />
                    </div>
                  )}
                  {status === 'warning' && (
                    <div className="absolute top-2 right-2 flex items-center justify-center text-amber-500 z-10 drop-shadow-sm">
                      <AlertTriangle className="w-5 h-5 fill-amber-500 stroke-[var(--node-bg)]" />
                    </div>
                  )}

                  {/* Node Context Menu */}
                  {isSelected && (
                    <div
                      className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2 cursor-default z-50 flex items-center gap-3 overflow-visible"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      {!isAttachmentNode ? (
                        <div
                          className={
                            SHOW_NODE_EXECUTION_CONTROLS ? 'contents' : 'hidden'
                          }
                          aria-hidden={!SHOW_NODE_EXECUTION_CONTROLS}
                        >
                          <button
                            className="text-muted hover:text-[var(--foreground)] transition-colors transform hover:scale-110"
                            title="Play"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayNode(node.id);
                            }}
                          >
                            <Play className="w-5 h-5 fill-current" />
                          </button>
                          <button
                            className="text-muted hover:text-[var(--foreground)] transition-colors transform hover:scale-110"
                            title="Power"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStopNode(node.id);
                            }}
                          >
                            <Power className="w-5 h-5" />
                          </button>
                        </div>
                      ) : null}
                      <button
                        className="text-muted hover:text-error transition-colors transform hover:scale-110"
                        title="Delete Node"
                        onClick={(e) => {
                          e.stopPropagation();
                          requestNodeDeletion([node.id]);
                        }}
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                      <button
                        className="text-muted hover:text-[var(--foreground)] transition-colors transform hover:scale-110"
                        title="More Options"
                        onClick={(e) => handleNodeContextMenu(e, node.id)}
                      >
                        <MoreHorizontal className="w-5 h-5" />
                      </button>
                    </div>
                  )}

                  {/* Node Label (below node) */}
                  {!isAIContainer && (
                    <div className="absolute top-[calc(100%+12px)] left-1/2 -translate-x-1/2 whitespace-nowrap">
                      {editingLabelNodeId === node.id ? (
                        <input
                          autoFocus
                          defaultValue={node.label}
                          className="bg-transparent border-b border-white/30 focus:border-white/60 outline-none text-base font-medium text-[var(--foreground)] text-center px-1 py-0.5 w-36 pointer-events-auto transition-colors"
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val)
                              setNodes((prev) =>
                                prev.map((n) =>
                                  n.id === node.id ? { ...n, label: val } : n,
                                ),
                              );
                            setEditingLabelNodeId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = (
                                e.target as HTMLInputElement
                              ).value.trim();
                              if (val)
                                setNodes((prev) =>
                                  prev.map((n) =>
                                    n.id === node.id ? { ...n, label: val } : n,
                                  ),
                                );
                              setEditingLabelNodeId(null);
                            }
                            if (e.key === 'Escape') setEditingLabelNodeId(null);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="font-medium text-[var(--foreground)] text-base drop-shadow-md cursor-default pointer-events-auto"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            const isLinkedEnvironment =
                              node.nodeType === 'environment' &&
                              node.config?.environmentId;
                            if (!isLinkedEnvironment) {
                              setEditingLabelNodeId(node.id);
                            }
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {node.label}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Connection HTML Overlays */}
            {connections.map((conn) => {
              const src = nodes.find((n) => n.id === conn.sourceId);
              const tgt = nodes.find((n) => n.id === conn.targetId);
              if (!src || !tgt) return null;

              const sPort =
                conn.role === 'attachment' ? 'top' : conn.sourcePort || 'right';
              const tPort =
                conn.role === 'attachment'
                  ? 'bottom'
                  : conn.targetPort || 'left';

              const startCoords = getPortCoordinates(src, sPort);
              const endCoords =
                conn.role === 'attachment' && conn.attachmentPort
                  ? getAttachmentPortCoordinates(tgt, conn.attachmentPort)
                  : getPortCoordinates(tgt, tPort, 10);

              const midPoint = getCurveMidpoint(
                startCoords.x,
                startCoords.y,
                endCoords.x,
                endCoords.y,
                sPort,
                tPort,
                connectionStyle,
              );
              const isHovered = hoveredConnectionId === conn.id;
              const isMenuOpen = connectionMenuId === conn.id;

              return (
                <div
                  key={`overlay-${conn.id}`}
                  className="absolute z-50 pointer-events-none"
                  style={{ left: midPoint.x, top: midPoint.y }}
                >
                  {conn.type &&
                    conn.type !== 'sequential' &&
                    !isHovered &&
                    !isMenuOpen && (
                      <div className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                        <div className="flex items-center justify-center">
                          <span
                            className={cn(
                              'text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shadow-sm',
                              conn.type === 'success'
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : conn.type === 'failure'
                                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                  : 'bg-surface border border-subtle text-muted',
                            )}
                          >
                            {conn.type}
                          </span>
                        </div>
                      </div>
                    )}

                  {/* Hover Actions */}
                  {(isHovered || isMenuOpen) && (
                    <div
                      className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                      onPointerEnter={() => setHoveredConnectionId(conn.id)}
                      onPointerLeave={() => setHoveredConnectionId(null)}
                    >
                      <div className="flex items-center gap-1 bg-surface border border-strong shadow-lg p-1 rounded-md">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnections((prev) =>
                              prev.filter((c) => c.id !== conn.id),
                            );
                            setHoveredConnectionId(null);
                            setConnectionMenuId(null);
                          }}
                          className="hover:bg-red-500/20 text-muted hover:text-red-400 p-1.5 rounded transition-colors block leading-none"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                        {conn.role !== 'attachment' ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConnectionMenuId(isMenuOpen ? null : conn.id);
                            }}
                            className="hover:bg-surface-hover text-muted hover:text-[var(--foreground)] p-1.5 rounded transition-colors block leading-none"
                            title="Settings"
                          >
                            <Settings size={14} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {/* Context Menu Popover */}
                  {isMenuOpen && conn.role !== 'attachment' && (
                    <div
                      className="absolute top-6 left-6 w-[200px] bg-surface border border-strong rounded-lg shadow-xl flex flex-col p-2 space-y-1 pointer-events-auto"
                      onPointerEnter={() => setHoveredConnectionId(conn.id)}
                      onPointerLeave={() => {
                        setConnectionMenuId(null);
                        setHoveredConnectionId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="px-2 py-1.5 border-b border-subtle mb-1 flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-[var(--foreground)]">
                          Line Condition
                        </h4>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnectionMenuId(null);
                          }}
                          className="text-muted hover:text-[var(--foreground)] p-0.5 rounded hover:bg-surface-hover"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      {(
                        [
                          'sequential',
                          'success',
                          'failure',
                          'concurrent',
                          'independent',
                        ] as ConnectionType[]
                      ).map((type) => (
                        <button
                          key={type}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnections((prev) =>
                              prev.map((c) =>
                                c.id === conn.id ? { ...c, type } : c,
                              ),
                            );
                            setConnectionMenuId(null);
                          }}
                          className={cn(
                            'flex items-center justify-between px-2 py-1.5 text-xs rounded hover:bg-surface-hover transition-colors',
                            conn.type === type ||
                              (!conn.type && type === 'sequential')
                              ? 'text-blue-400 bg-blue-500/10'
                              : 'text-muted hover:text-[var(--foreground)]',
                          )}
                        >
                          <span className="capitalize">{type}</span>
                          {(conn.type === type ||
                            (!conn.type && type === 'sequential')) && (
                            <CheckCircle2 size={14} />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed z-50 w-[160px] bg-surface border border-strong rounded-lg shadow-xl flex flex-col p-2 space-y-1 pointer-events-auto"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1.5 border-b border-subtle mb-1 flex items-center justify-between">
              <h4 className="text-xs font-semibold text-[var(--foreground)]">
                Node Options
              </h4>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu(null);
                }}
                className="text-muted hover:text-[var(--foreground)] p-0.5 rounded hover:bg-surface-hover"
              >
                <X size={12} />
              </button>
            </div>
            {(() => {
              const node = nodes.find((n) => n.id === contextMenu.nodeId);
              const hasReport = !!node?.output?.reportUrl;
              return (
                <>
                  <button
                    className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-surface-hover transition-colors text-muted hover:text-[var(--foreground)]"
                    onClick={() => {
                      setOpenNodeSettingsId(contextMenu.nodeId);
                      setContextMenu(null);
                    }}
                  >
                    Configure
                  </button>
                  {node?.nodeType === 'playwright' && (
                    <button
                      className={cn(
                        'w-full text-left px-2 py-1.5 text-xs rounded transition-colors',
                        hasReport
                          ? 'text-muted hover:text-[var(--foreground)] hover:bg-surface-hover'
                          : 'text-muted opacity-50 cursor-not-allowed',
                      )}
                      onClick={() => {
                        if (hasReport) {
                          void openAuthenticatedOutput(node.output!.reportUrl);
                          setContextMenu(null);
                        }
                      }}
                      disabled={!hasReport}
                    >
                      View Report
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Node Settings Modal */}
        {(() => {
          const node = openNodeSettingsId
            ? nodes.find((n) => n.id === openNodeSettingsId)
            : null;
          const iconElement = node
            ? renderNodeTypeIcon(node.nodeType, node.label)
            : undefined;
          const getAncestors = (targetId: string) => {
            const ancestors: any[] = [];
            const queue = [targetId];
            const visited = new Set<string>();

            while (queue.length > 0) {
              const currId = queue.shift()!;
              if (visited.has(currId)) continue;
              visited.add(currId);

              const parentIds = connections
                .filter((c) => c.targetId === currId)
                .map((c) => c.sourceId);

              for (const pid of parentIds) {
                if (!visited.has(pid) && !queue.includes(pid)) {
                  const pNode = nodes.find((n) => n.id === pid);
                  if (pNode && !ancestors.some((a) => a.id === pid)) {
                    ancestors.push(pNode);
                    queue.push(pid);
                  }
                }
              }
            }
            return ancestors;
          };

          const attachedContainerIds = node
            ? connections
                .filter(
                  (connection) =>
                    connection.role === 'attachment' &&
                    connection.sourceId === node.id,
                )
                .map((connection) => connection.targetId)
            : [];
          const executionOutput =
            node?.output ??
            nodes.find((candidate) =>
              attachedContainerIds.includes(candidate.id),
            )?.output;
          const incomingNodes = node
            ? Array.from(
                new Map(
                  [node.id, ...attachedContainerIds]
                    .flatMap((targetId) => getAncestors(targetId))
                    .filter(
                      (candidate) =>
                        candidate.id !== node.id &&
                        getIntegration(candidate.nodeType)?.executionRole !==
                          'attachment',
                    )
                    .map((candidate) => [candidate.id, candidate]),
                ).values(),
              )
            : [];

          return (
            <Modal
              isOpen={!!node}
              onClose={() => setOpenNodeSettingsId(null)}
              title={node ? node.label : 'Node Settings'}
              icon={iconElement}
              maxWidth="max-w-[calc(100vw-4rem)]"
              className="h-[calc(100vh-4rem)] max-h-none"
              bodyClassName="p-0 overflow-hidden flex flex-col"
            >
              {node && (
                <IntegrationConfigPanel
                  nodeId={node.id}
                  nodeLabel={node.label}
                  nodeType={node.nodeType}
                  config={node.config || {}}
                  onChange={handleNodeConfigChange}
                  onLabelChange={handleNodeLabelChange}
                  workflowCloudProvider={cloudProvider}
                  workflowId={workflowId}
                  executionOutput={executionOutput}
                  incomingNodes={incomingNodes}
                  onConnectOAuth={(provider) => {
                    const nodeIntegration = getIntegration(node.nodeType);
                    const integrationId =
                      provider ||
                      nodeIntegration?.authProviderId ||
                      nodeIntegration?.authProviders?.[0]?.id ||
                      node.nodeType;
                    const integration = getIntegration(integrationId);

                    if (integration?.SettingsModal) {
                      setActiveIntegrationSettingsId(integrationId);
                    } else if (integrationId) {
                      alert(`${integrationId} integration is not ready yet.`);
                    }
                  }}
                  className="w-full h-full border-0 rounded-none shadow-none"
                />
              )}
            </Modal>
          );
        })()}

        <Modal
          isOpen={!!selectedRuntimeChild}
          onClose={() => setSelectedRuntimeChildId(null)}
          title={
            selectedRuntimeChild?.childKind === 'shard'
              ? `Shard ${selectedRuntimeChild.shardIndex}/${selectedRuntimeChild.shardTotal}`
              : selectedRuntimeChild?.childKind === 'aggregate'
                ? 'Merged Playwright report'
                : 'Playwright test discovery'
          }
          icon={renderNodeTypeIcon('playwright', 'Playwright')}
          maxWidth="max-w-2xl"
        >
          {selectedRuntimeChild && (
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    Runtime child
                  </p>
                  <p className="break-all text-xs text-muted">
                    {selectedRuntimeChild.id}
                  </p>
                </div>
                <Badge>{selectedRuntimeChild.status}</Badge>
              </div>

              {selectedRuntimeChild.output?.reportUrl && (
                <Button
                  onClick={() =>
                    void openAuthenticatedOutput(
                      selectedRuntimeChild.output!.reportUrl,
                    )
                  }
                >
                  View report
                </Button>
              )}

              {selectedRuntimeChild.output && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Output
                  </p>
                  <pre className="max-h-56 overflow-auto rounded-lg border border-subtle bg-surface-hover p-3 text-xs text-[var(--foreground)]">
                    {JSON.stringify(selectedRuntimeChild.output, null, 2)}
                  </pre>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  Logs
                </p>
                <pre className="max-h-72 min-h-24 overflow-auto whitespace-pre-wrap rounded-lg border border-subtle bg-surface-hover p-3 text-xs text-[var(--foreground)]">
                  {selectedRuntimeChild.logs.length > 0
                    ? selectedRuntimeChild.logs.join('\n')
                    : 'No child logs received yet.'}
                </pre>
              </div>
            </div>
          )}
        </Modal>
      </div>
      <LogsPanel logs={orchestratorLogs} />

      {/* Toast Notification */}
      {saveStatus && (
        <div
          className={cn(
            'fixed bottom-6 left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2 px-4 py-2 rounded-xl shadow-xl flex items-start gap-2 z-[100] animate-in fade-in slide-in-from-bottom-4 transition-all',
            saveStatus.type === 'success'
              ? 'bg-emerald-500 text-white'
              : saveStatus.type === 'error'
                ? 'bg-red-500 text-white'
                : 'bg-amber-500 text-white',
          )}
        >
          {saveStatus.type === 'success' && (
            <CheckCircle2 className="w-4 h-4" />
          )}
          {saveStatus.type === 'error' && <XCircle className="w-4 h-4" />}
          {saveStatus.type === 'info' && <AlertTriangle className="w-4 h-4" />}
          <span className="min-w-0 whitespace-normal break-words text-sm font-medium">
            {saveStatus.message}
          </span>
        </div>
      )}
    </>
  );
}
