import type { Integration } from "@playrunner/integration-sdk";
import { JiraConfigPanel } from "./JiraConfigPanel";
import { JiraSettingsModal } from "./JiraSettingsModal";
import { jiraIconUrl } from "./icon";

export const jiraIntegration: Integration = {
  id: "jira",
  name: "Jira",
  category: "Project Management",
  description: "Create and sync Jira tickets",
  icon: jiraIconUrl,
  nodeType: "action",
  getAuthPath: (uid) => `users/${uid}/integrations/jira`,
  SettingsModal: JiraSettingsModal,
  ConfigPanel: JiraConfigPanel,
};

export { JiraConfigPanel } from "./JiraConfigPanel";
export { JiraSettingsModal } from "./JiraSettingsModal";
export { jiraIconUrl } from "./icon";
