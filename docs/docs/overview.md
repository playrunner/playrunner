---
sidebar_position: 1
title: Overview
---

# Playrunner Documentation

Playrunner is a visual workflow orchestration platform for running automated Playwright test pipelines. Connect triggers, integrations, and test runners by dragging nodes on a canvas — no glue code required.

---

## What's in these docs?

| Section                                                         | Description                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Tutorials](./tutorials/index.md)                               | Step-by-step guides to get up and running                                    |
| [Development](./local-dev/index.md)                             | Integration package authoring, workflow internals, and the local stack       |
| [Development → Integrations](./local-dev/integrations/index.md) | Frontend, API, and Orchestrator contribution contracts and build workflows   |
| [Integration Reference](./integration-packages/index.md)        | Available providers, configuration, and currently supported package surfaces |

---

## Architecture at a glance

```
Browser
  │
  ▼
Web App (Vite, :3100)
  │  /api/* and /outputs/* proxied to API
  ▼
API Server (Express, :3011)
  │  spawns on first Editor open
  ▼
Orchestrator (Docker, :3012)
  │  walks the DAG and prepares Playwright runners
  ▼
Playwright Runner (Docker, ephemeral)
  │  posts logs / state / output events
  ▼
API Server  →  PostgreSQL trace  →  SSE stream  →  Web App
```

---

## New here?

Start with the **[Getting Started](./tutorials/01-getting-started.md)** tutorial
— it walks you through cloning the repo, configuring your environment, and
booting the full stack in about 15 minutes.
