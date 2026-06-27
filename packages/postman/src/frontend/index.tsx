import type { Integration } from "@playrunner/integration-sdk";

export const postmanIntegration: Integration = {
  id: "postman",
  name: "Postman",
  category: "API Toolkit",
  description: "Trigger API collections automatically",
  icon: "/images/integrations/postman.svg",
  nodeType: "action",
  requiresAuth: false,
};
