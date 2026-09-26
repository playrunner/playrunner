import { Box } from 'lucide-react';
import { ALL_NODE_TYPES } from '../integrations/nodeCatalog';

export function NodeTypeIcon({ type }: { type: string }) {
  const node = ALL_NODE_TYPES.find((candidate) => candidate.id === type);
  if (node?.iconSrc)
    return (
      <img
        src={node.iconSrc}
        alt={node.label}
        className="h-5 w-5 shrink-0 object-contain"
      />
    );
  const Icon = node?.fallbackIcon || Box;
  return (
    <Icon
      className={`h-5 w-5 shrink-0 ${node?.color || 'text-muted'}`}
      aria-label={node?.label || 'Node'}
      role="img"
    />
  );
}
