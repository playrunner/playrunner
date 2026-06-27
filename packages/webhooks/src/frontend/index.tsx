import type { Integration } from "@playrunner/integration-sdk";

export const webhooksIntegration: Integration = {
  id: "webhooks",
  name: "Webhooks",
  category: "Custom",
  description: "Send generic HTTP requests",
  icon: "/images/integrations/webhook.svg",
  iconRenderMode: "mask",
  nodeType: "action",
  requiresAuth: false,
};
