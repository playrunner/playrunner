---
sidebar_position: 6
sidebar_label: Schedule
title: Schedule Integration
---

# Schedule Integration

`@playrunner/schedule` contains the built-in recurring schedule trigger node.

## Install

```bash
npm install @playrunner/schedule
```

npm: [@playrunner/schedule](https://www.npmjs.com/package/@playrunner/schedule) (placeholder until published)

## Exports

```ts
import { scheduleIntegration, ScheduleConfigPanel } from "@playrunner/schedule";
import { scheduleRouter } from "@playrunner/schedule/api";
```

## Frontend

The frontend entrypoint exports `scheduleIntegration`, which keeps the existing integration id as `schedule` so saved workflows continue to resolve their trigger nodes.

Schedule owns the configuration UI, including frequency, interval, timezone, and cron summary state.

## API

The API entrypoint exports an empty `scheduleRouter`, mounted by the host API at `/api/schedule`. The current Schedule node has no backend endpoints, but Schedule still exposes an API entrypoint so all integrations have the same frontend/API shape.

## Assets

Schedule uses the `AlarmClock` icon from `lucide-react`, so it does not need a packaged image asset.
