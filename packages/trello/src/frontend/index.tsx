import type { Integration } from "@playrunner/integration-sdk";

export const trelloIntegration: Integration = {
  id: "trello",
  name: "Trello",
  category: "Project Management",
  description: "Board based task management",
  icon: "/images/integrations/trello.svg",
  nodeType: "action",
  requiresAuth: false,
};
