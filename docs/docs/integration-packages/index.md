---
sidebar_position: 1
title: Overview
description: Available Playrunner integrations, their supported surfaces, and runtime configuration.
hide_title: true
---

import {
IntegrationDirectory,
IntegrationDirectoryHero,
IntegrationDirectoryItem,
} from '@site/src/components/IntegrationPage';

<IntegrationDirectoryHero title="Integrations">
Explore the integrations currently included in Playrunner builds. Each provider
page describes its available user setup and package surfaces.
</IntegrationDirectoryHero>

<IntegrationDirectory>
  <IntegrationDirectoryItem
    name="Jira"
    packageName="@playrunner/jira"
    description="Create and sync Jira tickets from Playrunner workflows."
    icon="jira"
    href="/docs/integration-packages/jira"
    installCommand="npm install @playrunner/jira"
  />
  <IntegrationDirectoryItem
    name="JavaScript"
    packageName="@playrunner/javascript"
    description="Configure JavaScript workflow nodes; execution support is not yet implemented."
    icon="javascript"
    href="/docs/integration-packages/javascript"
    installCommand="npm install @playrunner/javascript"
  />
  <IntegrationDirectoryItem
    name="GitHub"
    packageName="@playrunner/github"
    description="Connect repositories and manage GitHub authentication."
    icon="github"
    href="/docs/integration-packages/github"
    installCommand="npm install @playrunner/github"
  />
  <IntegrationDirectoryItem
    name="GCP"
    packageName="@playrunner/gcp"
    description="Connect Google Cloud and configure GCP runner infrastructure."
    icon="gcp"
    href="/docs/integration-packages/gcp"
    installCommand="npm install @playrunner/gcp"
  />
  <IntegrationDirectoryItem
    name="Environment"
    packageName="@playrunner/environment"
    description="Manage reusable environment variables for workflow nodes."
    icon="environment"
    href="/docs/integration-packages/environment"
    installCommand="npm install @playrunner/environment"
  />
  <IntegrationDirectoryItem
    name="Schedule"
    packageName="@playrunner/schedule"
    description="Configure workflows that are started by saved schedules."
    icon="schedule"
    href="/docs/integration-packages/schedule"
    installCommand="npm install @playrunner/schedule"
  />
  <IntegrationDirectoryItem
    name="OpenAI"
    packageName="@playrunner/openai"
    description="Generate text and structured output with OpenAI models."
    icon="openai"
    href="/docs/integration-packages/openai"
    installCommand="npm install @playrunner/openai"
  />
  <IntegrationDirectoryItem
    name="Hugging Face"
    packageName="@playrunner/huggingface"
    description="Run hosted open-source models through Hugging Face Inference Providers."
    icon="huggingface"
    href="/docs/integration-packages/huggingface"
    installCommand="npm install @playrunner/huggingface"
  />
  <IntegrationDirectoryItem
    name="Playwright"
    packageName="@playrunner/playwright"
    description="Run Playwright test workflows with repository-backed configuration."
    icon="playwright"
    href="/docs/integration-packages/playwright"
    installCommand="npm install @playrunner/playwright @playrunner/github"
  />
  <IntegrationDirectoryItem
    name="Slack"
    packageName="@playrunner/slack"
    description="Send notifications and alerts to Slack channels."
    icon="slack"
    href="/docs/integration-packages/slack"
    installCommand="npm install @playrunner/slack"
  />
</IntegrationDirectory>

## Build-time selection and runtime configuration

The install commands above are for the operator or build pipeline assembling a
Playrunner artifact. A running Playrunner deployment never installs integration
code from the marketplace or scans for new packages.

At runtime, users can connect credentials, add an integration node already
bundled into the deployment, choose its action, connect it to other nodes, and
edit its fields. Those operations update saved settings and workflow data; they
do not change the installed code.

Adding, upgrading, or removing an integration package requires rebuilding every
application or runner image that consumes one of its declared surfaces. Cloud
deployments must then publish and roll out the rebuilt artifacts.

## Building an integration

Package authors should use the
[Development → Integrations](../local-dev/integrations/) guide. It documents the
self-contained package contract and its three optional contribution surfaces:

- [Frontend contributions](../local-dev/integrations/frontend-contributions)
  provide integration metadata and package-owned React configuration UI.
- [API contributions](../local-dev/integrations/api-contributions) provide a
  stable mount path and package-owned Express router.
- [Orchestrator contributions](../local-dev/integrations/orchestrator-contributions.md)
  provide trusted, versioned workflow executors.

All three surfaces are declared by the package, selected as direct production
dependencies of the consuming artifact, and composed into static imports at
build time. Package authors do not add their provider to a shared registry or
host allowlist.
