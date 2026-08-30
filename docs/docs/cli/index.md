---
sidebar_position: 1
sidebar_label: Overview
title: Playrunner CLI
description: Run, create, and update Playrunner workflows from a terminal or CI/CD pipeline.
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
from declarative JSON files. It works in an interactive terminal and in CI/CD
systems that provide Node.js and network access to Playrunner.

## Choose a task

| Task                                           | Guide                                           |
| ---------------------------------------------- | ----------------------------------------------- |
| Start a saved workflow and wait for its result | [Run a workflow](./run-workflow.md)             |
| Use Playrunner as a CI/CD quality gate         | [Run a workflow](./run-workflow.md#run-in-cicd) |
| Create or update a workflow from JSON          | [Create a workflow](./create-workflow.md)       |

## Requirements

All CLI commands require:

- Node.js 20 or later.
- The URL of your Playrunner installation, supplied with `--url` or the
  `PLAYRUNNER_URL` environment variable.
- A Playrunner API token supplied through `PLAYRUNNER_API_KEY`.

Create tokens under **Settings → API tokens**. Restrict a token to selected
workflows when it only needs to run them. Creating or updating workflow
definitions requires an unrestricted token.

You can run the CLI without installing it globally:

```bash
npx playrunner --help
```

In automation, pin the package to a tested version so CLI upgrades are
deliberate:

```bash
npx --yes playrunner@0.1.4 --help
```

Store API tokens in protected, masked secrets. Never commit them to source
control or pass them in command-line arguments.
