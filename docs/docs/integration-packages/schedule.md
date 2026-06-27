---
sidebar_position: 6
title: Schedule Package
---

# Schedule Package

`@playrunner/schedule` contains the built-in recurring schedule trigger node.

## Exports

```ts
import { scheduleIntegration, ScheduleConfigPanel } from "@playrunner/schedule";
import { scheduleRouter } from "@playrunner/schedule/api";
```

## Frontend

The frontend entrypoint exports `scheduleIntegration`, which keeps the existing integration id as `schedule` so saved workflows continue to resolve their trigger nodes.

The package owns the schedule configuration UI, including frequency, interval, timezone, and cron summary state.

## API

The API entrypoint exports an empty `scheduleRouter`, mounted by the host API at `/api/schedule`. The current Schedule node has no backend endpoints, but the package still exposes an API entrypoint so all extracted integration packages have the same frontend/API shape.

## Assets

The Schedule package uses the `AlarmClock` icon from `lucide-react`, so it does not need a packaged image asset.
