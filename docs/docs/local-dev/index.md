---
sidebar_position: 1
title: Overview
description: Develop Playrunner integration packages and work with the local application stack.
---

# Development — Overview

Use this section to build self-contained integration packages, understand the
workflow runtime, and run the complete Playrunner stack locally.

## Start Here

Project setup now lives in the Tutorials section.

If you need to install dependencies, create the local `.env.local` and service `.env` files, let startup run setup on first launch, or start the app for the first time, use:

➡️ [Getting Started](../tutorials/getting-started)

The local-stack pages assume you have completed that setup. Integration package
authoring can be read independently, but validation requires the relevant app
dependencies to be installed.

## Choose a development area

| Area                                             | Use it for                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [Integrations](./integrations/)                  | Package architecture and frontend, API, Orchestrator, OAuth, build, validation, and deployment contributions. |
| [Services & Ports](./services-and-ports)         | Running and diagnosing the local application stack.                                                           |
| [Connection Nodes](./connection-nodes)           | Understanding graph connection and execution-order rules.                                                     |
| [Workflow Execution Flow](./workflow-execution)  | Following a workflow from the editor through the API, Orchestrator, and runner.                               |
| [Environment Variables](./environment-variables) | Configuring the local services.                                                                               |
| [Troubleshooting](./troubleshooting)             | Resolving common local-development failures.                                                                  |

The repo-root startup flow also launches the local Docusaurus site so the
product header can point at local documentation during development.

---

## Local stack at a glance

Playrunner is a workflow orchestration platform for running automated
Playwright test pipelines. Four application services must be available for a
fully functional local environment:

| Service               | Technology           | Port   | How it runs                                                 |
| --------------------- | -------------------- | ------ | ----------------------------------------------------------- |
| **Web App**           | React + Vite         | `3100` | `npm run dev` (host process)                                |
| **API**               | Express + TypeScript | `3011` | `npm start` (host process)                                  |
| **Orchestrator**      | Express + TypeScript | `3012` | Docker container (spawned by the API)                       |
| **Playwright Runner** | TypeScript + Python  | —      | Docker container (prepared and started by the Orchestrator) |

There is also one supporting host service:

| Service              | Port   | How it runs                         |
| -------------------- | ------ | ----------------------------------- |
| **Docs Site**        | `3104` | Host process via `./start-local.sh` |
| **Pub/Sub Emulator** | `8084` | Docker container                    |

---

## Architecture at a Glance

```text
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
  │  schedules Playwright runner preparation in the background, then starts runners by Pub/Sub control message
  ▼
Playwright Runner (Docker, ephemeral)
  │  publishes runner status / logs / state / output events
  ▼
Pub/Sub Emulator  →  API Server  →  PostgreSQL trace  →  SSE stream  →  Web App
```

Local Docker and GCP workflows use the same Pub/Sub messaging shape. Local runs publish to the Docker Pub/Sub emulator, while GCP runs publish to GCP Pub/Sub; in both cases the API pulls execution events with short non-blocking polling, persists them to PostgreSQL, and streams them to the editor via **Server-Sent Events (SSE)**. Runner control/status messages use the same topic and filtered subscriptions. The editor displays logs by event timestamp so API-side setup logs and cloud-published runner logs stay readable even when they arrive out of order.

---

## Repository Structure

```text
playrunner/
├── apps/
│   ├── api/                   # Express API server
│   ├── frontend/                   # React + Vite frontend
│   └── runners/
│       ├── orchestrator/      # Orchestrator runner (Docker image)
│       └── playwright/        # Playwright test runner (Docker image)
├── docs/                      # This documentation (Docusaurus)
├── packages/                  # Integration SDK and integrations
├── docker-compose.yml         # Docker-backed Postgres + Pub/Sub emulator
└── start-local.sh             # One-command local startup script
```
