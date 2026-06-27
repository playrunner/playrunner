import type { Integration } from "@playrunner/integration-sdk";

export const emailIntegration: Integration = {
  id: "email",
  name: "Email Notifications",
  category: "Communication",
  description: "Send reports via SMTP or API",
  icon: "/images/integrations/email.svg",
  nodeType: "action",
  requiresAuth: false,
};
