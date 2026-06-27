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
- Do not duplicate local-runner and cloud-runner protocol code. When local and GCP share behaviour such as Pub/Sub event transport, runner control/status signalling, node state transitions, or output-event publication, implement the shared protocol once and vary only the environment/configuration needed by each runtime.
- Do not send runner messages through API event callbacks. Logs, node state, runner control/status, and output events must go through the runner's messaging transport: local development defaults to the Pub/Sub emulator, GCP uses GCP Pub/Sub, and future AWS/Azure runners should use their provider-native messaging.
