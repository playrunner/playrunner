---
sidebar_position: 1
title: Overview
---

# Playrunner Documentation

Playrunner is a visual workflow orchestration platform for running automated Playwright test pipelines. Connect triggers, integrations, and test runners by dragging nodes on a canvas — no glue code required.

---

## What's in these docs?

| Section | Description |
|---|---|
| [Tutorials](./tutorials) | Step-by-step guides to get up and running |
| [Development](./local-dev) | Deep reference for the local development stack |

---

## Architecture at a glance

```
Browser
  │
  ▼
Web App (Vite, :3000)
  │  /api/* and /outputs/* proxied to API
  ▼
API Server (Express, :3001)
  │  spawns on first Editor open
  ▼
Orchestrator (Docker, :3002)
  │  spawns per node execution
  ▼
Playwright Runner (Docker, ephemeral)
  │  publishes logs via Pub/Sub
  ▼
Pub/Sub Emulator (:8085)
  │  messages forwarded via SSE
  ▼
API Server  →  SSE stream  →  Web App (real-time log panel)
```

---

## New here?

Start with the **[Getting Started](./tutorials/getting-started)** tutorial — it walks you through cloning the repo, configuring your environment, and booting the full stack in about 15 minutes.
