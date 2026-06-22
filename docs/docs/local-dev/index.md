---
sidebar_position: 1
title: Overview
---

# Development — Overview

> **This documentation covers local development only.**  
> It describes how to run the entire Playrunner stack on your own machine.

---

## Start Here

Project setup now lives in the Tutorials section.

If you need to install dependencies, create the local `.env` files, run the one-time setup flow, or start the app for the first time, use:

➡️ [Getting Started](../tutorials/getting-started)

The rest of the Development section assumes you have already completed that setup and just need reference material for specific parts of the stack.

---

## What is Playrunner?

Playrunner is a workflow orchestration platform for running automated Playwright test pipelines. It consists of four main services that must all be running locally to have a fully functional development environment:

| Service | Technology | Port | How it runs |
|---|---|---|---|
| **Web App** | React + Vite | `3000` | `npm run dev` (host process) |
| **API** | Express + TypeScript | `3001` | `npm start` (host process) |
| **Orchestrator** | Express + TypeScript | `3002` | Docker container (spawned by the API) |
| **Playwright Runner** | TypeScript + Python | — | Docker container (spawned by the Orchestrator) |

There is also a supporting infrastructure service:

| Service | Port | How it runs |
|---|---|---|
| **Google Cloud Pub/Sub Emulator** | `8085` | Docker container (via `docker compose`) |

---

## Architecture at a Glance

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

Pub/Sub is the message bus that decouples the Playwright runner (running inside Docker) from the API server. The API subscribes to the topic and forwards messages to any connected browser via **Server-Sent Events (SSE)**.

---

## Repository Structure

```
playrunner/
├── apps/
│   ├── api/                   # Express API server
│   ├── frontend/                   # React + Vite frontend
│   └── runners/
│       ├── orchestrator/      # Orchestrator runner (Docker image)
│       └── playwright/        # Playwright test runner (Docker image)
├── docs/                      # This documentation (Docusaurus)
├── docker-compose.yml         # Pub/Sub emulator only
└── start-local.sh             # One-command local startup script
```
