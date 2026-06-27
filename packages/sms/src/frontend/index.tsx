import type { Integration } from "@playrunner/integration-sdk";

export const smsIntegration: Integration = {
  id: "sms",
  name: "SMS / Twilio",
  category: "Communication",
  description: "Send critical text alerts",
  icon: "/images/integrations/twillo.svg",
  nodeType: "action",
  requiresAuth: false,
};
