import type { Integration } from "@playrunner/integration-sdk";

export const whatsappIntegration: Integration = {
  id: "whatsapp",
  name: "WhatsApp",
  category: "Messaging",
  description: "Send and receive WhatsApp messages",
  icon: "/images/integrations/whatsapp.svg",
  iconRenderMode: "mask",
  nodeType: "action",
  requiresAuth: false,
};
