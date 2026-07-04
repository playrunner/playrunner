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
    Exports `scheduleIntegration` and `ScheduleConfigPanel` for frequency,
    interval, timezone, and cron summary state.
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
import { scheduleIntegration, ScheduleConfigPanel } from "@playrunner/schedule";
import { scheduleRouter } from "@playrunner/schedule/api";
```

## Frontend

The frontend entrypoint exports `scheduleIntegration`, which keeps the existing integration id as `schedule` so saved workflows continue to resolve their trigger nodes.

Schedule owns the configuration UI, including frequency, interval, timezone, and cron summary state.

Schedule sets `showInputPanel: false`, so it does not accept inbound workflow connections. It can be added directly to the canvas, but it appears disabled in the node selector when the user is completing a connection target.

## API

The API entrypoint exports an empty `scheduleRouter`, mounted by the host API at `/api/schedule`. The current Schedule node has no backend endpoints, but Schedule still exposes an API entrypoint so all integrations have the same frontend/API shape.

## Assets

Schedule uses the `AlarmClock` icon from `lucide-react`, so it does not need a packaged image asset.
