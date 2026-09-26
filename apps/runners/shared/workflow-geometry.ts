export const DEFAULT_NODE_SIZE = 128;
export const AI_CONTAINER_WIDTH = 360;
export const AI_CONTAINER_HEIGHT = DEFAULT_NODE_SIZE;

type CanvasNode = { nodeType?: unknown; x?: unknown; y?: unknown };

// Nodes are not resizable. Their type, rather than imported geometry, owns
// the dimensions used by the body, sockets, connections, and viewport bounds.
export function getNodeDimensions(node: Pick<CanvasNode, 'nodeType'>) {
  return {
    width:
      node.nodeType === 'agent-container'
        ? AI_CONTAINER_WIDTH
        : node.nodeType === 'environment'
          ? DEFAULT_NODE_SIZE * (2 / Math.sqrt(3))
          : DEFAULT_NODE_SIZE,
    height: DEFAULT_NODE_SIZE,
  };
}

function coordinate(value: unknown, fallback: number) {
  const parsed =
    typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? parsed
    : fallback;
}

export function normalizeWorkflowNode<T extends CanvasNode>(
  node: T,
  index = 0,
) {
  return {
    ...node,
    x: coordinate(node.x, 200 + index * 300),
    y: coordinate(node.y, 300),
    ...getNodeDimensions(node),
  };
}

// Preserve the store API's existing null/omitted-field behavior. Structural
// validation of workflow definitions remains the caller's responsibility.
export function normalizeWorkflowNodes(value: unknown) {
  return Array.isArray(value)
    ? value.map((node: unknown, index) =>
        node && typeof node === 'object' && !Array.isArray(node)
          ? normalizeWorkflowNode(node, index)
          : node,
      )
    : value;
}
