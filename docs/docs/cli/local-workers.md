---
sidebar_position: 5
sidebar_label: Run on your own machine
title: Run Cloud tests on your own machine
description: Connect a laptop, server or VM to Playrunner Cloud, execute Playwright tests on its compute, and keep logs and reports in Cloud.
---

# Run Cloud tests on your own machine

Playrunner Cloud can coordinate a workflow while a machine you choose runs its
Playwright tests in Docker. Results, live logs, test metrics, reports and
captured artifacts stay in Cloud. The machine can be your development laptop,
another computer, a server or a VM; it does not have to be the computer where
you open the editor.

## Choose where tests run

Open the runner menu in the workflow editor toolbar.

| Choice               | Where tests execute                        | Setup                                                                                  |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| **Playrunner Cloud** | Playrunner's servers                       | Select this option to use managed compute.                                             |
| **Your machines**    | An explicitly selected machine you control | Choose **Connect a machine**, then follow the steps below.                             |
| **GCP Runner**       | Your configured Google Cloud project       | Connect your project using the [GCP setup guide](../runner-architecture/gcp/setup.md). |

**Playrunner Cloud** replaces the previous **Hosted Runner** label. Its menu
notice says that execution time will be billed. This release adds the notice
only; it does not enable execution-time billing. Running tests on your own
machine uses that machine's resources, while Cloud still coordinates the run
and stores its results.

The **Local Runner** in a local Playrunner installation is a separate setup:
it runs the local API, orchestrator and supporting services. See
[Local Runner Architecture](../runner-architecture/local.md) for that deployment.

## Requirements

On the machine that will execute tests:

- Install Node.js 20 or later.
- Install and start Docker with support for Linux containers.
- Use Playrunner CLI 0.3.0 or later. The examples pin `0.3.0`.
- Allow outbound access to Playrunner Cloud and the services your tests use.

In Cloud, use a workflow you own with TypeScript Playwright steps and sharding
disabled. Shared workflows, Python Playwright steps and AI Container steps are
not supported for this execution mode.

## 1. Pair the machine

In the editor, open **runner menu → Connect a machine**. Run the following
command in a terminal on the machine you want to connect:

```bash
npx playrunner@0.3.0 login --url https://playrunner.cloud
```

Open the approval URL printed by the CLI if it does not open automatically.
Sign in with the same Cloud account you use in the editor, check that the
pairing code matches, and approve the device. For a server or VM without a
browser, open that URL on another computer.

Pairing and worker connections do not require `PLAYRUNNER_API_KEY`. The URL
used by `worker connect` must match the installation approved during pairing.

## 2. Prepare the runner

With Docker running, build the local test runner image:

```bash
npx playrunner@0.3.0 worker prepare
```

Allow the image build to finish before connecting the worker.

## 3. Connect the worker

To run the tests configured in your workflow:

```bash
npx playrunner@0.3.0 worker connect --url https://playrunner.cloud --cpu 2 --memory 4
```

Keep this terminal and Docker running. The machine appears under **Your
machines** with its name, resource limits and **Online** status. Use
**Refresh machines** if needed. Previously connected machines can remain in
the list as **Offline**; they cannot be selected for a new run.

The default limits are 2 CPUs and 4 GiB of memory. `--cpu` accepts a whole
number from 1 to 32, and `--memory` accepts 1 to 64 GiB. Choose limits your
machine can supply. Each Playwright step's configured resources must fit
within those limits; larger requests are rejected before execution.

### Use a local test folder

To test uncommitted changes, open a terminal in your test project and connect
with `--workspace .`:

```bash
npx playrunner@0.3.0 worker connect --url https://playrunner.cloud --cpu 2 --memory 4 --workspace .
```

The setup dialog's **Use a local test folder, including uncommitted changes**
checkbox shows this command. It does not grant access to a folder by itself;
you must run the command on the selected machine.

The worker mounts the selected directory read-only and copies its files into
the test container. Uncommitted files are included. `.git`, `node_modules`,
report directories and symbolic links are excluded. Tests execute against the
copy rather than modifying the mounted checkout.

## 4. Select the machine and run

1. Open the runner menu and select the intended **Online** machine under
   **Your machines**.
2. Reopen the menu to choose **Test source**:
   - **Tests configured in this workflow** uses the workflow's test source.
   - **Folder on the selected machine** uses the folder supplied with
     `--workspace`. This option is unavailable without a connected workspace.
3. Confirm the toolbar shows the intended machine's name and **Online** status.
4. Press **Run**, or run an individual Playwright step.
5. Follow progress and open the report in Cloud as usual.

Manual editor runs use the current graph, including unsaved changes and the
selected step when running a single step. The machine choice applies to manual
runs in that editor session; it is not saved as the workflow's scheduled
runner. After reopening or refreshing the editor, select the machine again.
Scheduled runs use the workflow's saved cloud runner. Plugin requests must
also select a machine explicitly; they do not inherit the editor's choice.

### Test a development server on the selected machine

Inside the test container, `localhost` refers to the container. Use
`host.docker.internal` to reach an application running on the machine hosting
that container, for example:

```text
http://host.docker.internal:3000
```

Set this as the application's base URL in your test or Environment
configuration. Ensure the development server accepts connections from Docker.
For a worker on another server, this address refers to that server, not the
computer where you have the editor open.

## Reports, stopping and disconnections

Cloud retains the workflow's execution history, logs, test results and uploaded
reports and media. Local execution supports one Playwright step at a time;
sharding is unavailable. The worker's prepared Playwright version must match
an explicitly selected version in the workflow, or the workflow may use
`latest`.

Use the step's stop control in the editor to cancel an assigned local step.
Press **Ctrl+C** in the worker terminal to disconnect the worker. If the
machine disconnects or loses its connection, work is interrupted and Cloud
records the failure once detected. It never silently retries that run on
Playrunner's servers or another machine. Check the existing execution before
starting a new run, since tests may already have performed actions.

## Use the plugin or an MCP client

First connect the worker using the steps above. Ask your connected assistant
to list local workers and run the saved workflow on the chosen machine. The
assistant must use the returned device ID and request local execution
explicitly. See [Run on a connected machine](../mcp/tools.md#run-on-a-connected-machine)
for tool arguments, result polling and cancellation.

The [authentication companion](./authentication-companion.md) is a different
CLI process: `auth connect` accepts browser sign-in requests, while `worker connect`
accepts test work. Pairing alone, or running the authentication
companion, does not make a machine available for test execution.

## Troubleshooting

| Symptom                                               | What to check                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No machines are listed                                | Run `worker connect`, keep it open, and verify that pairing used the same Cloud account and URL as the editor. |
| A machine is Offline                                  | Start Docker and reconnect the worker. Refresh the menu and wait for Online before selecting it.               |
| The local runner image is missing                     | Run `worker prepare` successfully on that machine.                                                             |
| The local-folder option is unavailable                | Reconnect with `--workspace` pointing to the test project directory.                                           |
| A run exceeds resource limits                         | Reduce the step's CPU/memory settings or reconnect with higher limits that the machine can supply.             |
| The Playwright version does not match                 | Match the workflow to the prepared worker version, or select `latest`.                                         |
| Python, AI Container or sharding is rejected          | Use TypeScript Playwright with sharding disabled and remove AI Container steps from the local run.             |
| The test cannot reach localhost                       | Use `host.docker.internal` for a server running on the worker's host and check its network binding.            |
| The wrong machine is shown after reopening the editor | Select the intended machine again; the editor does not persist this manual-run choice.                         |
