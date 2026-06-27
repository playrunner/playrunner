---
sidebar_position: 10
title: Remote Runner Messaging
---

# Remote Runner Messaging

> **Local development only.** This describes how workflow messages move when a cloud runner is used while the Playrunner API is running on your machine.

---

## Message Flow

Local Docker workflows publish logs, node states, output events, and runner control signals through the local Pub/Sub emulator. The Playwright runner still reaches the API at `http://host.docker.internal:3001` to upload compressed output archives.

GCP workflows use the same messaging architecture against GCP Pub/Sub. The Orchestrator and Playwright Runner execute inside GCP, publish messages to GCP Pub/Sub, and your local API pulls those messages over outbound HTTPS, writes them to PostgreSQL, and streams them to the editor.

Future cloud runners should follow the same shape with their provider-native messaging service. AWS should use its AWS messaging transport, and Azure should use its Azure messaging transport.

---

## Debugging Checklist

| Symptom | Check |
| --- | --- |
| Local logs do not appear | Confirm the `pubsub` Docker service is running and `PUBSUB_EMULATOR_HOST` points to it from the API process. |
| Local runner waits forever | Confirm `PUBSUB_EMULATOR_HOST_DOCKER` points to the emulator from inside Docker, usually `host.docker.internal:8085`. |
| GCP logs do not appear | Confirm Terraform created the workflow events topic and the connected GCP user can create filtered pull subscriptions. |
| GCP runner does not start tests | Confirm the Orchestrator can publish runner control messages to the workflow events topic and the Playwright job has the current runner image. |
| Editor stream connects but is empty | Confirm the API process is pulling messages and writing execution events to PostgreSQL. |

---

## What Still Uses HTTP

The API still serves the editor REST API, SSE stream, static output files, and local compressed output archive uploads. Workflow messages from runners use provider messaging.
