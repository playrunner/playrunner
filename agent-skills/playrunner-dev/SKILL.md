---
name: playrunner-dev
description: Development rules for working in the Playrunner repo. Use whenever making code changes in this repository to govern when to update related documentation and how to confirm a code change before moving on.
---

# Playrunner Dev

## Overview

Rules that govern day-to-day code changes in the Playrunner repo, separate from styling/design concerns. Apply these to any code edit, regardless of language or app.

## Rules

- When making a change to code, do not update the docs as part of that change. Wait until the user explicitly asks for the docs to be updated.
- When you finish the current code block of work, ask the user whether they have tested the change and are happy with it, and offer to update the docs once they confirm.
- Do not deploy, push container images, run Terraform apply, delete/recreate cloud resources, consume Pub/Sub messages, or otherwise mutate live cloud state unless the user has explicitly asked for that exact action or has confirmed a direct deployment/mutation prompt. Local builds, lint, typecheck, and read-only cloud inspection are acceptable.
- For cloud runtime fixes, stop after implementing and locally verifying the code. Tell the user the exact deploy command separately and ask whether they want it run.
- For GCP workflow, Cloud Run, orchestrator, or Playwright runner fixes, close out with the operational handoff the user needs to test the change: tell them to restart the local API so package/API runtime changes are loaded, tell them to try the workflow again in the editor, and state whether pushed runner images are needed. If pushed images are needed, give the exact command without running it unless the user confirms: `./infra/gcp/scripts/push-runners.sh --target orchestrator --yes` for orchestrator-only changes, `./infra/gcp/scripts/push-runners.sh --target playwright --yes` for Playwright runner image changes, or `./infra/gcp/scripts/push-runners.sh --target both --yes` when both images changed.
- Do not duplicate local-runner and cloud-runner protocol code. When local and GCP share behaviour such as Pub/Sub event transport, runner control/status signalling, node state transitions, or output-event publication, implement the shared protocol once and vary only the environment/configuration needed by each runtime.
- Do not send runner messages through API event callbacks. Logs, node state, runner control/status, and output events must go through the runner's messaging transport: local development defaults to the Pub/Sub emulator, GCP uses GCP Pub/Sub, and future AWS/Azure runners should use their provider-native messaging.
