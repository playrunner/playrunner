import type { Integration } from './types';

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
  executionRole: 'workflow' | 'attachment';
  attachmentKind?: 'agent' | 'memory' | 'tool';
  acceptsAttachments: readonly ('agent' | 'memory' | 'tool')[];
};

export function createNodeTypeCatalog(integrations: readonly Integration[]) {
  const all: AppNodeType[] = integrations.map((integration) => ({
    id: integration.id,
    label: integration.name,
    type: integration.nodeType || 'action',
    color: integration.color,
    iconRenderMode: integration.iconRenderMode,
    nodeSelectorOrder: integration.nodeSelectorOrder,
    acceptsInboundConnection: integration.showInputPanel !== false,
    executionRole: integration.executionRole || 'workflow',
    attachmentKind: integration.attachmentKind,
    acceptsAttachments: integration.acceptsAttachments || [],
    ...(typeof integration.icon === 'string'
      ? { iconSrc: integration.icon }
      : { fallbackIcon: integration.icon }),
  }));
  const visibleIds = new Set(
    integrations
      .filter((integration) => integration.showInNodeSelector !== false)
      .map((integration) => integration.id),
  );
  const visibleParents = all.filter(
    (node) => visibleIds.has(node.id) && node.executionRole === 'workflow',
  );
  const selectable = all.filter(
    (node) =>
      visibleIds.has(node.id) &&
      (node.executionRole !== 'attachment' ||
        (node.attachmentKind &&
          visibleParents.some((parent) =>
            parent.acceptsAttachments.includes(node.attachmentKind!),
          ))),
  );

  return { all, selectable };
}
