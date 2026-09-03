import type { AppNodeType } from '../components/NodeSelectorModal';

export const DEFAULT_PROJECT_NODE_TYPES = ['environment', 'playwright'];

export function normalizeProjectNodeTypes(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : DEFAULT_PROJECT_NODE_TYPES;
}

export function createStarterWorkflow(
  nodeTypeIds: string[],
  availableNodeTypes: AppNodeType[],
) {
  const availableById = new Map(
    availableNodeTypes.map((nodeType) => [nodeType.id, nodeType]),
  );
  const createdAt = Date.now();
  const nodes = nodeTypeIds.flatMap((nodeTypeId, index) => {
    const nodeType = availableById.get(nodeTypeId);
    if (!nodeType) return [];

    return [
      {
        id: `${nodeTypeId}-${createdAt}-${index}`,
        nodeType: nodeType.id,
        label: nodeType.label,
        x: 200 + index * 300,
        y: 300,
        width: 128,
        height: 128,
      },
    ];
  });
  const connections = nodes.slice(1).flatMap((target, index) => {
    const source = nodes[index];
    const targetType = availableById.get(target.nodeType);
    if (!targetType?.acceptsInboundConnection) return [];

    return [
      {
        id: `conn-${createdAt}-${index}`,
        sourceId: source.id,
        targetId: target.id,
        sourcePort: 'right',
        targetPort: 'left',
      },
    ];
  });

  return { nodes, connections };
}
