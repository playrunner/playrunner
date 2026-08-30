---
sidebar_position: 1
sidebar_label: Create a workflow
title: Create a workflow with the Playrunner CLI
description: Define a Playrunner project and workflow in JSON, create or update it with the CLI, and open the resulting workflow in the visual editor.
keywords:
  [
    'playrunner cli',
    'create playrunner workflow',
    'workflow as code',
    'playrunner json workflow',
  ]
---

# Create a workflow with the Playrunner CLI

The Playrunner CLI can create a project and workflow from a JSON file. This is
useful when you want to keep the initial workflow definition in source control,
provision the same workflow in another Playrunner installation, or generate a
workflow from another tool.

Running the command again with the same project and workflow keys updates the
existing workflow. You can then open the returned URL to inspect or continue
editing it on the visual canvas.

## Prerequisites

You need:

- Node.js 20 or later.
- The URL of your Playrunner installation, such as
  `https://playrunner.cloud` or `http://127.0.0.1:3100`.
- An unrestricted Playrunner API token.

To create the token, open **Settings → API tokens**, select **Create token**,
and leave **Allowed workflows** empty. A token restricted to selected workflows
can run those workflows, but cannot create or update them. Copy the token when
it is shown; Playrunner stores only its hash and cannot display it again.

Export the URL and token in your shell:

```bash
export PLAYRUNNER_URL='https://playrunner.cloud'
export PLAYRUNNER_API_KEY='<your-api-token>'
```

For a self-hosted or local installation, replace the URL with the address of
that installation. Store the token in a protected, masked secret when you use
the command in CI/CD. Do not put it in the workflow definition.

## Create a definition file

Save the following as `playrunner-workflow.json`:

```json
{
  "project": {
    "key": "cli-examples",
    "title": "CLI examples"
  },
  "workflow": {
    "key": "hello-world",
    "title": "Hello world",
    "cloudProvider": "LOCAL_RUNNER",
    "concurrency": 1,
    "nodes": [
      {
        "id": "environment",
        "nodeType": "environment",
        "label": "Environment",
        "x": 200,
        "y": 300,
        "width": 128,
        "height": 128,
        "config": {
          "variables": [
            {
              "id": "greeting",
              "key": "GREETING",
              "type": "default",
              "initialValue": "Hello from the CLI",
              "currentValue": "Hello from the CLI",
              "enabled": true
            }
          ]
        }
      },
      {
        "id": "javascript",
        "nodeType": "code",
        "label": "Print greeting",
        "x": 500,
        "y": 300,
        "width": 128,
        "height": 128,
        "config": {
          "code": "console.log(env.GREETING);\nreturn { greeting: env.GREETING };"
        }
      }
    ],
    "connections": [
      {
        "id": "environment-to-javascript",
        "sourceId": "environment",
        "targetId": "javascript",
        "sourcePort": "right",
        "targetPort": "left"
      }
    ]
  }
}
```

The `x`, `y`, `width`, `height`, `label`, `config`, and connection port fields
are canvas and node configuration data. The create API preserves them, but only
the identity and graph fields described below are required.

## Create the workflow

Run:

```bash
npx playrunner workflow create --file playrunner-workflow.json
```

The CLI prints whether it created or updated the workflow, followed by its
editor URL:

```text
Created workflow cli-workflow-0123456789abcdef0123456789abcdef
Open in Playrunner: https://playrunner.cloud/workflow/cli-workflow-0123456789abcdef0123456789abcdef
```

Open that URL to view, configure, or run the workflow. The actual IDs are
generated deterministically for your account and will differ from this example.

Pass the server URL directly if you do not want to set `PLAYRUNNER_URL`:

```bash
npx playrunner workflow create \
  --file playrunner-workflow.json \
  --url https://playrunner.cloud
```

Use `--json` when another command needs to consume the result:

```bash
npx playrunner workflow create \
  --file playrunner-workflow.json \
  --json
```

The command writes one JSON object to standard output:

```json
{
  "created": true,
  "editorUrl": "https://playrunner.cloud/workflow/cli-workflow-0123456789abcdef0123456789abcdef",
  "projectId": "cli-project-0123456789abcdef0123456789abcdef",
  "workflowId": "cli-workflow-0123456789abcdef0123456789abcdef"
}
```

## Definition reference

The root JSON object contains `project` and `workflow` objects.

| Field                    | Required | Description                                                                                                                   |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `project.key`            | Yes      | Stable project identity. Use 1–100 letters, numbers, dots, underscores, or hyphens. The first character must be alphanumeric. |
| `project.title`          | Yes      | Project display name, from 1–200 characters.                                                                                  |
| `workflow.key`           | Yes      | Stable workflow identity within the project. It follows the same rules as `project.key`.                                      |
| `workflow.title`         | Yes      | Workflow display name, from 1–200 characters.                                                                                 |
| `workflow.nodes`         | Yes      | An array of up to 500 node objects. It may be empty.                                                                          |
| `workflow.connections`   | Yes      | An array of up to 1,000 connection objects. It may be empty.                                                                  |
| `workflow.cloudProvider` | No       | Runner provider ID. It defaults to `LOCAL_RUNNER`.                                                                            |
| `workflow.concurrency`   | No       | Integer from 1–100 that limits concurrent workflow runs.                                                                      |

Every node requires a unique `id` and a `nodeType`, each from 1–100
characters. A connection requires `sourceId` and `targetId`, and both must name
nodes in the same definition. Other node and connection properties are
preserved for the editor and the integration that owns the node.

Schedule nodes cannot currently be created through an API token. Add schedules
in the visual editor after creating the workflow.

The JSON file must be no larger than 2 MiB. Playrunner also rejects environment
nodes that embed a value for a variable with `"type": "secret"`. Configure
secrets in Playrunner and refer to them from the workflow instead of committing
secret values to source control.

## How updates work

The keys, not the titles, determine identity:

- `project.key` identifies the project for the account that owns the API token.
- The combination of `project.key` and `workflow.key` identifies the workflow.
- Reusing both keys replaces the stored title, nodes, connections, runner
  provider, and concurrency with the new definition.
- Changing either key creates a different workflow. Changing `project.key`
  also targets a different project.

The operation is an upsert, so the same definition can be applied repeatedly.
The generated project and workflow IDs remain stable for the same account and
keys.

## What the CLI sends

The command:

1. Reads the JSON file and checks its size.
2. Parses the JSON and checks that `workflow.key` is present.
3. Sends the complete definition with an authenticated `PUT` request to
   `/api/v1/workflows/definitions/<workflow-key>`.
4. Lets the Playrunner server validate the complete definition and create or
   update the project and workflow in one transaction.
5. Prints the workflow ID and editor URL returned by the server.

The CLI does not write the API token to disk or include it in the request URL or
output. It removes credentials, query parameters, and fragments from the server
URL before making the request.

The command exits with status `0` after a successful create or update, and
status `2` for invalid options, file or JSON errors, authentication and
authorization failures, validation errors, or unsuccessful requests. Server
validation messages are written to standard error.

Run the built-in help to see the available options:

```bash
npx playrunner workflow create --help
```

After the workflow exists, see
[Run your first test](/docs/tutorials/run-your-first-test/) for running a saved
workflow by ID.
