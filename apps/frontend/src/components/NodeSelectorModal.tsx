import { useState, useRef } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { INTEGRATIONS } from '../integrations/registry';

interface NodeSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (data: { typeId: string; label: string }) => void;
  getNodeDisabledReason?: (node: AppNodeType) => string | null | undefined;
}

export type AppNodeType = {
  id: string;
  label: string;
  type: string;
  iconSrc?: string;
  iconRenderMode?: 'image' | 'mask';
  fallbackIcon?: any;
  color?: string;
  fallbackText?: string;
  nodeSelectorOrder?: number;
  acceptsInboundConnection: boolean;
};

export const NODE_TYPES: AppNodeType[] = [
  ...INTEGRATIONS.filter((i) => i.showInNodeSelector !== false).map((i) => ({
    id: i.id,
    label: i.name,
    type: i.nodeType || 'action',
    color: i.color,
    iconRenderMode: i.iconRenderMode,
    nodeSelectorOrder: i.nodeSelectorOrder,
    acceptsInboundConnection: i.showInputPanel !== false,
    ...(typeof i.icon === 'string'
      ? { iconSrc: i.icon }
      : { fallbackIcon: i.icon }),
  })),
];

export function NodeSelectorModal({
  isOpen,
  onClose,
  onSelect,
  getNodeDisabledReason,
}: NodeSelectorModalProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const filteredNodes = NODE_TYPES.filter((n) =>
    n.label.toLowerCase().includes(search.toLowerCase()),
  );
  const pinnedNodes = filteredNodes.filter(
    (n) => typeof n.nodeSelectorOrder === 'number',
  );
  const otherNodes = filteredNodes.filter(
    (n) => typeof n.nodeSelectorOrder !== 'number',
  );
  pinnedNodes.sort(
    (a, b) => (a.nodeSelectorOrder ?? 0) - (b.nodeSelectorOrder ?? 0),
  );

  const isNodeDisabled = (node: AppNodeType) =>
    Boolean(getNodeDisabledReason?.(node));

  const renderNodeButton = (node: AppNodeType) => {
    const disabledReason = getNodeDisabledReason?.(node);
    const isDisabled = Boolean(disabledReason);

    return (
      <button
        key={node.id}
        onClick={() => onSelect({ typeId: node.id, label: node.label })}
        className={cn(
          'w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left group',
          isDisabled
            ? 'opacity-45 cursor-not-allowed'
            : 'hover:bg-surface-hover',
        )}
        disabled={isDisabled}
      >
        <div className="w-10 h-10 rounded-lg bg-background border border-subtle flex items-center justify-center shrink-0 shadow-sm p-1.5">
          {node.iconSrc ? (
            node.iconRenderMode === 'mask' ? (
              <div
                className="w-full h-full bg-current"
                style={{
                  WebkitMaskImage: `url(${node.iconSrc})`,
                  WebkitMaskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskImage: `url(${node.iconSrc})`,
                  maskSize: 'contain',
                  maskRepeat: 'no-repeat',
                  maskPosition: 'center',
                }}
              />
            ) : (
              <img
                src={node.iconSrc}
                alt={node.label}
                className="w-full h-full object-contain"
              />
            )
          ) : node.fallbackIcon ? (
            <node.fallbackIcon className={cn('w-5 h-5', node.color)} />
          ) : node.fallbackText ? (
            <div className="text-[12px] font-medium tracking-wide">
              {node.fallbackText}
            </div>
          ) : null}
        </div>
        <div>
          <div
            className={cn(
              'text-sm font-medium',
              isDisabled ? 'text-muted' : 'text-[var(--foreground)]',
            )}
          >
            {node.label}
          </div>
          <div className="text-xs text-muted">
            {disabledReason || (
              <span className="capitalize">{node.type} node</span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md bg-surface border border-strong rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-subtle">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              ref={inputRef}
              autoFocus
              className="w-full bg-background border border-subtle rounded-lg pl-9 pr-4 py-2 text-sm text-[var(--foreground)] placeholder:text-muted focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-all"
              placeholder="Search tools..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter' && filteredNodes.length > 0) {
                  const firstNode = [...pinnedNodes, ...otherNodes].find(
                    (node) => !isNodeDisabled(node),
                  );
                  if (firstNode)
                    onSelect({ typeId: firstNode.id, label: firstNode.label });
                }
              }}
            />
          </div>
        </div>
        <div className="p-2 overflow-y-auto">
          {filteredNodes.length === 0 ? (
            <div className="text-center py-8 text-muted text-sm">
              No tools found
            </div>
          ) : (
            <>
              {pinnedNodes.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                      Most commonly used
                    </span>
                  </div>
                  {pinnedNodes.map(renderNodeButton)}
                </div>
              )}
              {otherNodes.length > 0 && (
                <div>
                  {pinnedNodes.length > 0 && (
                    <div className="mx-3 my-1 border-t border-subtle" />
                  )}
                  <div className="px-3 pt-2 pb-1">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                      All integrations
                    </span>
                  </div>
                  {otherNodes.map(renderNodeButton)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
