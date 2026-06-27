import type { Integration } from '@playrunner/integration-sdk';
import { asanaIntegration } from '../../../asana/src/frontend';
import { emailIntegration } from '../../../email/src/frontend';
import { environmentIntegration } from '../../../environment/src/frontend';
import { geminiIntegration } from '../../../gemini/src/frontend';
import { githubIntegration } from '../../../github/src/frontend';
import { googlechatIntegration } from '../../../googlechat/src/frontend';
import { javascriptIntegration } from '../../../javascript/src/frontend';
import { jiraIntegration } from '../../../jira/src/frontend';
import { openaiIntegration } from '../../../openai/src/frontend';
import { playwrightIntegration } from '../../../playwright/src/frontend';
import { postmanIntegration } from '../../../postman/src/frontend';
import { scheduleIntegration } from '../../../schedule/src/frontend';
import { slackIntegration } from '../../../slack/src/frontend';
import { smsIntegration } from '../../../sms/src/frontend';
import { trelloIntegration } from '../../../trello/src/frontend';
import { webhooksIntegration } from '../../../webhooks/src/frontend';
import { whatsappIntegration } from '../../../whatsapp/src/frontend';

export const packageIntegrations: Integration[] = [
  jiraIntegration,
  githubIntegration,
  playwrightIntegration,
  javascriptIntegration,
  environmentIntegration,
  scheduleIntegration,
  slackIntegration,
  googlechatIntegration,
  asanaIntegration,
  trelloIntegration,
  postmanIntegration,
  emailIntegration,
  smsIntegration,
  whatsappIntegration,
  webhooksIntegration,
  openaiIntegration,
  geminiIntegration,
];

export const packageIntegrationRegistry: Record<string, Integration> =
  Object.fromEntries(
    packageIntegrations.map((integration) => [integration.id, integration]),
  );
