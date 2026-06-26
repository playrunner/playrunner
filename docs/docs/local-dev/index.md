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

If you need to install dependencies, create the local `.env.local` and service `.env` files, let startup run setup on first launch, or start the app for the first time, use:

➡️ [Getting Started](../tutorials/getting-started)

The rest of the Development section assumes you have already completed that setup and just need reference material for specific parts of the stack. The repo-root startup flow also launches the local Docusaurus site so the product header can point at local docs during development.

---

## What is Playrunner?

Playrunner is a workflow orchestration platform for running automated Playwright test pipelines. It consists of four main services that must all be running locally to have a fully functional development environment:

| Service               | Technology           | Port   | How it runs                                    |
| --------------------- | -------------------- | ------ | ---------------------------------------------- |
| **Web App**           | React + Vite         | `3000` | `npm run dev` (host process)                   |
| **API**               | Express + TypeScript | `3001` | `npm start` (host process)                     |
| **Orchestrator**      | Express + TypeScript | `3002` | Docker container (spawned by the API)          |
| **Playwright Runner** | TypeScript + Python  | —      | Docker container (spawned by the Orchestrator) |

There is also one supporting host service:

| Service       | Port              | How it runs                         |
| ------------- | ----------------- | ----------------------------------- |
| **Docs Site** | `3004` by default | Host process via `./start-local.sh` |

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
  │  posts logs / state / output events
  ▼
API Server  →  PostgreSQL trace  →  SSE stream  →  Web App
```

Local Docker workflows use direct API callbacks because every service can reach the API on the host. GCP workflows use GCP Pub/Sub by default: the cloud runner publishes events to a GCP topic, the local API pulls them over outbound HTTPS, persists them to PostgreSQL, and streams them to the editor via **Server-Sent Events (SSE)**.

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
├── docker-compose.yml         # Docker-backed Postgres
└── start-local.sh             # One-command local startup script
```
