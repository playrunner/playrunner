import type { Integration } from "@playrunner/integration-sdk";

export const googlechatIntegration: Integration = {
  id: "googlechat",
  name: "Google Chat",
  category: "Messaging",
  description: "Integration for Google Workspace",
  icon: "/images/integrations/googlechat.svg",
  nodeType: "action",
  requiresAuth: false,
};
