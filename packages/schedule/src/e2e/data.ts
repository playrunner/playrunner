import type { PlayrunnerE2EDataContext } from "@playrunner/integration-sdk/e2e";

export interface ScheduleE2EData {
  runId: string;
}

export function createScheduleE2EData({
  runId,
}: PlayrunnerE2EDataContext): ScheduleE2EData {
  return { runId };
}
