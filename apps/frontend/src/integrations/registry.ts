import type { Integration } from './types';
import { jiraIntegration } from '@playrunner/jira';
import { githubIntegration } from '@playrunner/github';
import { playwrightIntegration } from '@playrunner/playwright';
import { javascriptIntegration } from '@playrunner/javascript';
import { environmentIntegration } from '@playrunner/environment';
import { scheduleIntegration } from '@playrunner/schedule';
import { editionIntegrations } from '@edition-runtime';

function createPremiumIntegrationStub(
  id: string,
  name: string,
  description: string,
  icon: string,
): Integration {
  return {
    category: 'Cloud Providers',
    description,
    disabled: true,
    disabledReason:
      'Premium feature. Start premium mode to connect this cloud provider.',
    icon,
    id,
    isPremiumFeature: true,
    name,
    nodeType: 'trigger',
  };
}

// You can add more placeholder integrations here
export const REGISTRY: Record<string, Integration> = {
  jira: jiraIntegration,
  github: githubIntegration,
  playwright: playwrightIntegration,
  code: javascriptIntegration,
  environment: environmentIntegration,
  schedule: scheduleIntegration,

  // Stubs for others shown in UI
  aws: createPremiumIntegrationStub(
    'aws',
    'AWS Cloud',
    'Connect to your AWS infrastructure',
    '/images/integrations/aws.svg',
  ),
  azure: createPremiumIntegrationStub(
    'azure',
    'Azure Cloud',
    'Connect to Microsoft Azure',
    '/images/integrations/azure.svg',
  ),
  gcp: createPremiumIntegrationStub(
    'gcp',
    'Google Cloud',
    'Connect to Google Cloud Platform',
    '/images/integrations/gcp.svg',
  ),
  slack: {
    id: 'slack',
    name: 'Slack',
    category: 'Messaging',
    description: 'Send notifications and alerts to Slack',
    icon: '/images/integrations/slack.svg',
    nodeType: 'action',
  },
  googlechat: {
    id: 'googlechat',
    name: 'Google Chat',
    category: 'Messaging',
    description: 'Integration for Google Workspace',
    icon: '/images/integrations/googlechat.svg',
    nodeType: 'action',
  },
  asana: {
    id: 'asana',
    name: 'Asana',
    category: 'Project Management',
    description: 'Manage tasks and tracking',
    icon: '/images/integrations/asana.svg',
    nodeType: 'action',
  },
  trello: {
    id: 'trello',
    name: 'Trello',
    category: 'Project Management',
    description: 'Board based task management',
    icon: '/images/integrations/trello.svg',
    nodeType: 'action',
  },
  postman: {
    id: 'postman',
    name: 'Postman',
    category: 'API Toolkit',
    description: 'Trigger API collections automatically',
    icon: '/images/integrations/postman.svg',
    nodeType: 'action',
  },
  email: {
    id: 'email',
    name: 'Email Notifications',
    category: 'Communication',
    description: 'Send reports via SMTP or API',
    icon: '/images/integrations/email.svg',
    nodeType: 'action',
  },
  sms: {
    id: 'sms',
    name: 'SMS / Twilio',
    category: 'Communication',
    description: 'Send critical text alerts',
    icon: '/images/integrations/twillo.svg',
    nodeType: 'action',
  },
  whatsapp: {
    id: 'whatsapp',
    name: 'WhatsApp',
    category: 'Messaging',
    description: 'Send and receive WhatsApp messages',
    icon: '/images/integrations/whatsapp.svg',
    nodeType: 'action',
  },
  webhooks: {
    id: 'webhooks',
    name: 'Webhooks',
    category: 'Custom',
    description: 'Send generic HTTP requests',
    icon: '/images/integrations/webhook.svg',
    nodeType: 'action',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    category: 'AI & ML',
    description: 'Generate text and analyze data',
    icon: '/images/integrations/openai.svg',
    nodeType: 'action',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'AI & ML',
    description: 'Multimodal AI models by Google',
    icon: '/images/integrations/gemini.svg',
    nodeType: 'action',
  },
  ...Object.fromEntries(
    editionIntegrations.map((integration) => [integration.id, integration]),
  ),
};

export const INTEGRATIONS = Object.values(REGISTRY);

export function getIntegration(id: string): Integration | undefined {
  return REGISTRY[id];
}
