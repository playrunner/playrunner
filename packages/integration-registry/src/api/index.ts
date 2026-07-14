import { environmentApiContribution } from '../../../environment/src/api';
import { gcpApiContribution } from '../../../gcp/src/api';
import { githubApiContribution } from '../../../github/src/api';
import { javascriptApiContribution } from '../../../javascript/src/api';
import { jiraApiContribution } from '../../../jira/src/api';
import { playwrightApiContribution } from '../../../playwright/src/api';
import { scheduleApiContribution } from '../../../schedule/src/api';
import { slackApiContribution } from '../../../slack/src/api';

export const packageApiContributions = [
  gcpApiContribution,
  githubApiContribution,
  environmentApiContribution,
  jiraApiContribution,
  javascriptApiContribution,
  playwrightApiContribution,
  scheduleApiContribution,
  slackApiContribution,
];

export function registerIntegrationApiRoutes(app: {
  use: (mountPath: string, router: unknown) => void;
}): void {
  for (const contribution of packageApiContributions) {
    app.use(contribution.mountPath, contribution.router);
  }
}
