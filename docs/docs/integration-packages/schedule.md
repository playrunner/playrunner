---
sidebar_position: 7
sidebar_label: Schedule
title: Schedule Integration
description: Start Playrunner workflows on recurring schedules.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="Schedule"
packageName="@playrunner/schedule"
description="Start workflows on recurring schedules with frequency, interval, timezone, and cron summary state built into the node."
icon="schedule"
installCommand="npm install @playrunner/schedule"
npmUrl="https://www.npmjs.com/package/@playrunner/schedule"
badges={['Trigger node', 'Recurring runs', 'No auth']}
facts={[
{ label: 'Node type', value: 'Trigger' },
{ label: 'Integration id', value: 'schedule' },
{ label: 'Backend mount', value: '/api/schedule' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Schedule configuration UI">
    Default-exports `scheduleIntegration` and also exports `ScheduleConfigPanel`
    for frequency, interval, timezone, and cron summary state.
  </IntegrationCard>

  <IntegrationCard eyebrow="Workflow model" title="Trigger node config">
    Schedule settings are node-specific, so they belong in the workflow node
    `config` rather than account-level integration storage.
  </IntegrationCard>

  <IntegrationCard eyebrow="Backend" title="Consistent API shape">
    Exports `scheduleRouter`, mounted at `/api/schedule`, even though the current
    Schedule node has no backend endpoints.
  </IntegrationCard>

  <IntegrationCard eyebrow="Icon" title="Lucide source">
    Uses the `AlarmClock` icon from `lucide-react`, so it does not need a
    packaged image asset.
  </IntegrationCard>
</IntegrationGrid>

## Exports

```ts
import scheduleIntegration, { ScheduleConfigPanel } from "@playrunner/schedule";
import scheduleApiContribution, {
  scheduleRouter,
} from "@playrunner/schedule/api";
```

The same contribution objects remain available as named exports. The default
exports are the build-composition contract.

## Frontend

The frontend entrypoint default-exports `scheduleIntegration`, which keeps the
existing integration id as `schedule` so saved workflows continue to resolve
their trigger nodes.

Schedule owns the configuration UI, including frequency, interval, timezone, and cron summary state.

Schedule sets `showInputPanel: false`, so it does not accept inbound workflow
connections. It can be added directly to the canvas, but it appears disabled in
the node selector when the user is completing a connection target.

The package manifest declares the `schedule` ID plus its `.` frontend and
`./api` surfaces, and both entrypoints default-export their contribution.
Frontend and API builds discover those surfaces from installed direct production
dependencies and generate static imports; no shared registry edit is required.

## API

The API entrypoint default-exports `scheduleApiContribution`, containing the
empty `scheduleRouter` and its `/api/schedule` mount path. The current Schedule
node has no package-local backend endpoints.

## Orchestrator

The Schedule package does not currently declare an `./orchestrator` surface.
Schedule triggers remain on explicit host-managed scheduling and Orchestrator
paths. The package-owned contribution model currently supplies Schedule's
frontend and API surfaces only.

## Assets

Schedule uses the `AlarmClock` icon from `lucide-react`, so it does not need a packaged image asset.
