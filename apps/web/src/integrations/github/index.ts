import type { Integration } from "../types";
import { GithubSettingsModal } from "./GithubSettingsModal";

export const githubIntegration: Integration = {
  id: "github",
  name: "GitHub",
  category: "Version Control",
  description: "Sync repositories and trigger actions",
  icon: "/images/integrations/github.svg",
  nodeType: "trigger",
  getAuthPath: (uid) => `users/${uid}/integrations/github`,
  SettingsModal: GithubSettingsModal,
};
