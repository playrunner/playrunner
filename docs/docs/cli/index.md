---
sidebar_position: 1
sidebar_label: Overview
title: Playrunner CLI
description: Run and define workflows from a terminal, or connect a local browser to Playrunner Cloud Authentication Profiles.
keywords:
  [
    'playrunner cli',
    'run playrunner workflow',
    'playrunner command line',
    'playrunner ci cd',
  ]
---

# Playrunner CLI

Use the Playrunner CLI to run saved workflows or create and update workflows
from declarative JSON files. It also pairs a computer with Playrunner Cloud so
Authentication Profiles can capture a signed-in browser session in native
Chrome. The CLI works in an interactive terminal and in CI/CD systems that
provide Node.js and network access to Playrunner.

## Choose a task

| Task                                               | Guide                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| Start a saved workflow and wait for its result     | [Run a workflow](./run-workflow.md)                                   |
| Use Playrunner as a CI/CD quality gate             | [Run a workflow](./run-workflow.md#run-in-cicd)                       |
| Create or update a workflow from JSON              | [Create a workflow](./create-workflow.md)                             |
| Capture a Cloud Authentication Profile with Chrome | [Connect the authentication companion](./authentication-companion.md) |

## Command overview

| Command                                  | Purpose                                                        | Authentication          |
| ---------------------------------------- | -------------------------------------------------------------- | ----------------------- |
| `playrunner WORKFLOW_ID`                 | Run a saved workflow and optionally wait for its result        | API token               |
| `playrunner workflow create --file FILE` | Create or update a project and workflow from JSON              | Unrestricted API token  |
| `playrunner login`                       | Pair this computer with a Playrunner Cloud account             | Browser device approval |
| `playrunner auth connect`                | Connect in the foreground and accept browser capture requests  | Paired device           |
| `playrunner auth status`                 | Show whether this computer is paired, online, or revoked       | Paired device           |
| `playrunner auth disconnect`             | Revoke this computer, stop its service, and remove credentials | Paired device           |

Run the top-level help or authentication help for the commands available in
your installed version:

```bash
playrunner --help
playrunner auth --help
```

## Install or run the CLI

All commands require Node.js 20 or later.

For workflow commands and CI/CD, you can run the CLI without installing it
globally:

```bash
npx --yes playrunner@0.2.5 --help
```

Pinning the version in automation makes CLI upgrades deliberate.

For the Authentication Profile companion, install the CLI globally on the
computer where Chrome will open:

```bash
npm install --global playrunner@latest
playrunner --version
```

## Workflow command authentication

All workflow run and workflow creation commands require:

- The URL of your Playrunner installation, supplied with `--url` or the
  `PLAYRUNNER_URL` environment variable.
- A Playrunner API token supplied through `PLAYRUNNER_API_KEY`.

Create tokens under **Settings → API tokens**. Restrict a token to selected
workflows when it only needs to run them. Creating or updating workflow
definitions requires an unrestricted token.

Store API tokens in protected, masked secrets. Never commit them to source
control or pass them in command-line arguments.

## Authentication Profile companion

Companion commands use device pairing instead of `PLAYRUNNER_API_KEY`. The
shortest working Cloud setup is:

```bash
playrunner login
playrunner auth connect
```

Approve the matching code in the Playrunner Cloud page opened by `login`. Keep
the `auth connect` terminal open, then open **Authentication Profiles** in
Cloud, choose the online computer under **Paired devices**, and click
**Authenticate** on a profile. Complete sign-in in Chrome and press **Enter**
in the companion terminal to validate and upload the captured state.

See [Connect the CLI for Cloud Authentication
Profiles](./authentication-companion.md) for the complete pairing, browser
capture, revocation, security, and troubleshooting guide. The CLI also has an
optional advanced background-service mode; it is not part of the required
login-and-connect flow.

The CLI is not involved after capture. Hosted Runner workflows restore the
encrypted profile through an execution-bound handoff even when the paired
computer is offline. Playrunner Cloud does not provide a separate session-test
action; run the workflow to verify the stored state through the same path used
by a real execution.
