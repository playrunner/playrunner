export function sanitizeInteractiveExecutionBody(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) =>
        key !== 'agentMemoryByNodeId' &&
        key !== 'authenticationStatesByNodeId' &&
        key !== 'authenticationProfileNodeIds' &&
        key !== 'ci',
    ),
  );
}

export function machineExecutionCiPolicyError(
  nodes: unknown,
  eventType: unknown,
): string | null {
  const containsAgentContainer =
    Array.isArray(nodes) &&
    nodes.some(
      (node) =>
        node !== null &&
        typeof node === 'object' &&
        !Array.isArray(node) &&
        (node as Record<string, unknown>).nodeType === 'agent-container',
    );
  if (!containsAgentContainer || eventType === 'push') return null;
  return 'AI Container machine executions support trusted source push events only. pull_request and manual CI contexts are not supported.';
}
