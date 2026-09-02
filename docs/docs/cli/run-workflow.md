---
sidebar_position: 2
sidebar_label: Run a workflow
title: Run a workflow with the Playrunner CLI
description: Start a saved Playrunner workflow from a terminal or CI/CD pipeline, stream its progress, and use its exit status as a quality gate.
keywords:
  [
    'run playrunner workflow cli',
    'playrunner ci cd',
    'playrunner workflow command',
    'playwright quality gate',
  ]
---

# Run a workflow with the Playrunner CLI

The Playrunner CLI starts an existing saved workflow by ID. By default, it
streams progress, waits up to 30 minutes, and exits successfully only when the
workflow completes.

## Find the workflow ID

Open the saved workflow in Playrunner. Its URL has this form:

```text
https://playrunner.cloud/workflow/2cc84235-58f7-4cb1-89cd-0c379d3b6908
```

Copy the value after `/workflow/`. Do not copy an example ID from the
documentation.

## Create an API token

1. Open **Settings → API tokens**.
2. Select **Create token**.
3. Give the token a descriptive name, such as `CI`.
4. Restrict it to the workflow when appropriate.
5. Copy the token when it is shown. Playrunner cannot display it again.

## Run the workflow

Export the server URL and API token, then pass the workflow ID as the first
argument:

```bash
export PLAYRUNNER_URL='https://playrunner.cloud'
export PLAYRUNNER_API_KEY='<your-api-token>'

npx playrunner 2cc84235-58f7-4cb1-89cd-0c379d3b6908
```

For a self-hosted or local installation, replace the server URL with the URL of
that environment. You can also pass it directly:

```bash
npx playrunner WORKFLOW_ID --url http://127.0.0.1:3100
```

Replace `WORKFLOW_ID` with the saved workflow's ID.

## Control waiting and output

The default command waits for the final workflow status. Use these options to
change that behavior:

| Option          | Behavior                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| `--no-wait`     | Return after Playrunner accepts the run.                                   |
| `--timeout 10m` | Change the wait deadline. Durations support `ms`, `s`, `m`, and `h`.       |
| `--json`        | Emit newline-delimited JSON lifecycle records for another tool to consume. |

A completed workflow returns exit code `0`. Invalid input, authentication or
request errors, timeouts, cancelled runs, and failed workflows return a
non-zero exit code. Keep the default waiting behavior when the command is a
quality gate.

## Pass workflow inputs

Repeat `--input` to provide named values to the workflow run:

```bash
npx playrunner WORKFLOW_ID \
  --input environment=staging \
  --input release=2026.08.30
```

Input names must start with a letter and may contain letters, numbers, dots,
underscores, and hyphens.

Repeat `--acceptance-criteria` to attach requirements to the run:

```bash
npx playrunner WORKFLOW_ID \
  --acceptance-criteria 'CHECKOUT-1: a customer can complete checkout' \
  --acceptance-criteria 'CHECKOUT-2: a declined card shows an error'
```

## Pass source-change context

The CLI can attach repository and commit context for workflows that inspect a
change. When any change-context option is used, provide the complete context:

```bash
npx playrunner WORKFLOW_ID \
  --repository playrunner/playrunner \
  --base-sha 1111111111111111111111111111111111111111 \
  --head-sha 2222222222222222222222222222222222222222 \
  --base-ref main \
  --head-ref feature/checkout \
  --event-type pull_request \
  --pull-request 123
```

`--event-type` accepts `manual`, `push`, or `pull_request`.
`--pull-request` is required only for `pull_request` events. The same values can
be supplied with the `PLAYRUNNER_REPOSITORY`, `PLAYRUNNER_BASE_SHA`,
`PLAYRUNNER_HEAD_SHA`, `PLAYRUNNER_BASE_REF`, `PLAYRUNNER_HEAD_REF`,
`PLAYRUNNER_EVENT_TYPE`, and `PLAYRUNNER_PULL_REQUEST_NUMBER` environment
variables. In GitHub Actions, the CLI also reads the corresponding standard
GitHub environment variables where available.

## Run in CI/CD

Store `PLAYRUNNER_API_KEY` as a protected, masked CI/CD secret. The workflow ID
is an identifier, not a credential, so it can be present in pipeline
configuration.

This GitHub Actions job runs Playrunner for pull requests and pushes to `main`:

```yaml
name: Playrunner quality gate

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  end-to-end:
    runs-on: ubuntu-latest
    timeout-minutes: 35
    steps:
      - name: Run Playrunner workflow
        env:
          PLAYRUNNER_API_KEY: ${{ secrets.PLAYRUNNER_API_KEY }}
        run: >-
          npx --yes playrunner@0.2.1
          2cc84235-58f7-4cb1-89cd-0c379d3b6908
          --url https://playrunner.cloud
          --timeout 30m
```

Pinning the CLI version makes pipeline runs reproducible. Set the job timeout
slightly longer than the CLI timeout so the CLI can report a useful error
before the CI provider stops the job.

The same command works in GitLab CI, CircleCI, Buildkite, Jenkins, and other
providers that can run Node.js and reach Playrunner.

## Environment variables

| Variable                         | Purpose                                            |
| -------------------------------- | -------------------------------------------------- |
| `PLAYRUNNER_API_KEY`             | Machine API token. Required.                       |
| `PLAYRUNNER_URL`                 | Playrunner server URL. Can be replaced by `--url`. |
| `PLAYRUNNER_REPOSITORY`          | GitHub repository in `owner/name` form.            |
| `PLAYRUNNER_BASE_SHA`            | Complete base commit SHA.                          |
| `PLAYRUNNER_HEAD_SHA`            | Complete head commit SHA.                          |
| `PLAYRUNNER_BASE_REF`            | Base branch name.                                  |
| `PLAYRUNNER_HEAD_REF`            | Head branch name.                                  |
| `PLAYRUNNER_EVENT_TYPE`          | `manual`, `push`, or `pull_request`.               |
| `PLAYRUNNER_PULL_REQUEST_NUMBER` | Pull request number for a `pull_request` event.    |

Run the built-in help for the complete option list:

```bash
npx playrunner --help
```

## Troubleshooting

| Symptom                        | Resolution                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Playrunner URL is required     | Pass `--url` or export `PLAYRUNNER_URL`.                                              |
| API key is required            | Export `PLAYRUNNER_API_KEY`.                                                          |
| `command not found`            | Use `npx playrunner` or install the CLI globally.                                     |
| The workflow cannot be started | Check that the token is allowed to run that workflow.                                 |
| The command times out          | Increase `--timeout`, then inspect the workflow's node status and logs in Playrunner. |
