import { ALL_NODE_TYPES } from '../../integrations/nodeCatalog';
import { cn } from '../../lib/utils';

export function WorkflowNodeIcon({ nodeTypeId }: { nodeTypeId: string }) {
  const nodeType = ALL_NODE_TYPES.find((n) => n.id === nodeTypeId);
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
        <Icon className={cn('w-16 h-16 pointer-events-none', nodeType.color)} />
      );
    }
  }
  return (
    <span className="text-sm font-mono opacity-50 uppercase pointer-events-none">
      {nodeTypeId.substring(0, 2)}
    </span>
  );
}

export function EnvironmentNodeShape({
  status = 'idle',
  isSelected = false,
}: {
  status?: string;
  isSelected?: boolean;
}) {
  return (
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
  );
}
