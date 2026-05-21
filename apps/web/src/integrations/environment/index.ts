import type { Integration } from "../types";
import { EnvironmentConfigPanel } from "./EnvironmentConfigPanel";
import { Settings } from "lucide-react";

export const environmentIntegration: Integration = {
  id: "environment",
  name: "Environment",
  category: "Config",
  description: "Configure environment variables",
  icon: Settings,
  nodeType: "config",
  color: "text-blue-500",
  requiresAuth: false,
  ConfigPanel: EnvironmentConfigPanel,
};
