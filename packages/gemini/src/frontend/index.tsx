import type { Integration } from "@playrunner/integration-sdk";

export const geminiIntegration: Integration = {
  id: "gemini",
  name: "Google Gemini",
  category: "AI & ML",
  description: "Multimodal AI models by Google",
  icon: "/images/integrations/gemini.svg",
  nodeType: "action",
  requiresAuth: false,
};
