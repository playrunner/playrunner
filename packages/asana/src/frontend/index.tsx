import type { Integration } from "@playrunner/integration-sdk";

export const asanaIntegration: Integration = {
  id: "asana",
  name: "Asana",
  category: "Project Management",
  description: "Manage tasks and tracking",
  icon: "/images/integrations/asana.svg",
  nodeType: "action",
  requiresAuth: false,
};
