import type { Integration } from "@playrunner/integration-sdk";
import { PlaywrightConfigPanel } from "./PlaywrightConfigPanel";
import { GithubSettingsModal } from "@playrunner/github";
import { playwrightIconUrl } from "./icon";

export const playwrightIntegration: Integration = {
  id: "playwright",
  name: "Playwright",
  category: "Testing",
  description: "Connect to your Playwright testing suite",
  icon: playwrightIconUrl,
  nodeType: "trigger",
  nodeSelectorOrder: 10,
  showAuthenticationPanel: false,
  showInIntegrationsPage: false,
  authProviders: [
    { id: "github", label: "GitHub" },
    { id: "bitbucket", label: "Bitbucket" },
  ],
  getAuthPath: (uid) => `users/${uid}/integrations/github`,
  SettingsModal: GithubSettingsModal,
  ConfigPanel: PlaywrightConfigPanel,
};

export { PlaywrightConfigPanel } from "./PlaywrightConfigPanel";
export { playwrightIconUrl } from "./icon";
