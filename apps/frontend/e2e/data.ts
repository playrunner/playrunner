import { randomUUID } from 'node:crypto';
import type { TestInfo } from '@playwright/test';

export function createWorkspaceData(info: TestInfo) {
  const runId = `${info.workerIndex}-${info.retry}-${randomUUID().slice(0, 8)}`;
  return {
    project: `E2E Project ${runId}`,
    workflow: `E2E Workflow ${runId}`,
    environment: `E2E Environment ${runId}`,
    profile: `E2E Profile ${runId}`,
    team: `E2E Team ${runId}`,
    token: `E2E Token ${runId}`,
    memberEmail: `member-${runId}@example.test`,
  };
}
