import { cn } from '../../lib/utils';

export function workflowNodeAppearance({
  isEnvironmentNode,
  isScheduleNode,
  isAttachmentNode,
  isAIContainer,
  status = 'idle',
  isSelected = false,
}: {
  isEnvironmentNode: boolean;
  isScheduleNode: boolean;
  isAttachmentNode: boolean;
  isAIContainer: boolean;
  status?: string;
  isSelected?: boolean;
}) {
  return cn(
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
  );
}
