import type { Integration } from "@playrunner/integration-sdk";

export const openaiIntegration: Integration = {
  id: "openai",
  name: "OpenAI",
  category: "AI & ML",
  description: "Generate text and analyze data",
  icon: "/images/integrations/openai.svg",
  iconRenderMode: "mask",
  nodeType: "action",
  requiresAuth: false,
};
