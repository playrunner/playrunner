import type { Integration } from "@playrunner/integration-sdk";

export const slackIntegration: Integration = {
  id: "slack",
  name: "Slack",
  category: "Messaging",
  description: "Send notifications and alerts to Slack",
  icon: "/images/integrations/slack.svg",
  nodeType: "action",
  nodeSelectorOrder: 50,
  requiresAuth: false,
};
