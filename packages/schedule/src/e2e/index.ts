import { definePlayrunnerE2EContribution } from "@playrunner/integration-sdk/e2e";
import { createScheduleE2EData } from "./data";
import { ScheduleE2EPom } from "./ScheduleE2EPom";

export const scheduleE2EContribution = definePlayrunnerE2EContribution({
  id: "schedule",
  createData: createScheduleE2EData,
  createPom: ({ host, page }) => new ScheduleE2EPom(page, host),
  scenarios: [
    {
      id: "configuration-only-composition",
      mode: "mock",
      title: "composes Schedule as a configuration-only integration",
      tags: ["@schedule", "@integration"],
      async run({ data, expect, pom }) {
        expect(data.runId).toBeTruthy();
        await pom.openCatalog();
        await expect(pom.card).toHaveCount(0);
      },
    },
  ],
});

export default scheduleE2EContribution;

export { createScheduleE2EData } from "./data";
export type { ScheduleE2EData } from "./data";
export { ScheduleE2EPom } from "./ScheduleE2EPom";
