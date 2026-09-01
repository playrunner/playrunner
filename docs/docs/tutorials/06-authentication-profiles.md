---
sidebar_position: 6
title: Reuse Browser Sessions with Authentication Profiles
description: Create, verify, and reuse an encrypted browser session in local Playwright workflow runs without storing identity-provider passwords.
keywords:
  - playwright authentication
  - browser session
  - storage state
  - authenticated playwright tests
---

# Reuse Browser Sessions with Authentication Profiles

Authentication Profiles let a Playwright node begin with a real signed-in
browser session. You sign in manually in a visible browser, Playrunner captures
the resulting browser state, and later Local runner executions restore that
state without storing your identity-provider password.

Use a separate profile for each application, Environment, and test role that
needs an independent session.

## Before you start

You need:

- A running local Playrunner API with interactive authentication enabled.
- Google Chrome or a compatible Chromium browser available on the API host.
- A saved [Environment](../integration-packages/environment.md) for the target
  application.
- A workflow that uses the **Local runner**. Authentication Profiles do not
  currently support managed or other remote runners.

Authentication Profiles belong to their owner. A shared workflow run cannot
use the workflow owner's saved browser session.

## Step 1 — Create a profile

1. Open **Authentication Profiles** from the Playrunner sidebar.
2. Click **Create profile**.
3. Complete the profile fields:

| Field                                | Purpose                                                               |
| ------------------------------------ | --------------------------------------------------------------------- |
| **Name**                             | A recognizable name, such as `Staging Clinic Admin`                   |
| **Environment**                      | The saved Environment that isolates this profile                      |
| **Application label**                | An optional display name for the application                          |
| **Role / test account**              | An optional label for the signed-in role or account                   |
| **Start URL**                        | The credential-free HTTP(S) page where authentication begins          |
| **Authentication success condition** | The URL or visible element that proves sign-in completed successfully |

4. Click **Save profile**.

Changing the Environment, start URL, or success condition later marks an
authenticated profile for reauthentication.

## Step 2 — Choose a reliable success condition

Playrunner verifies the success condition before it captures or accepts a
browser session.

| Condition           | Use it when                                                     | Example                                     |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| **URL prefix**      | Successful sign-in can lead to several pages below one base URL | `https://staging.example.com/app`           |
| **Exact URL**       | Successful sign-in always finishes on one exact URL             | `https://staging.example.com/app/dashboard` |
| **Element visible** | The URL is unchanged, but a stable signed-in element appears    | `[data-testid="account-menu"]`              |

Prefer a condition that only an authenticated user can reach. Avoid selectors
for loading indicators, consent banners, or other elements that can also
appear before sign-in.

## Step 3 — Authenticate in the visible browser

1. Find the new profile and click **Authenticate**.
2. Complete the normal sign-in flow in the Chrome window Playrunner opens.
   This can include redirects, single sign-on, and multifactor authentication.
3. Leave the browser open and return to Playrunner.
4. Click **I've finished signing in**.
5. Wait for the profile status to become **Authenticated**.

Playrunner verifies the configured success condition, captures cookies, local
storage, and IndexedDB state, encrypts that state, and records the earliest
known future cookie expiry. It does not record the password you entered in the
browser.

If verification fails, confirm that the browser reached the expected URL or
that the configured selector is visible, then authenticate again.

## Step 4 — Test the stored session

Click **Test session** on an authenticated profile. Playrunner opens a visible
browser with the stored state, navigates to the start URL, and verifies the same
success condition.

Testing the session before attaching it to a workflow is the quickest way to
detect an expired server-side session, a changed login flow, or an unreliable
success condition.

## Step 5 — Attach the profile to a Playwright node

1. Open the workflow editor.
2. Add an **Environment** node and select the same saved Environment used by
   the Authentication Profile.
3. Connect the Environment node to the **Playwright** node.
4. Open the Playwright node configuration.
5. Under **Authentication Profile**, select the authenticated profile.
6. Select the **Local runner**, save the workflow, and run it.

Playrunner rejects the run if the matching Environment is not linked, the
profile is not authenticated, the profile belongs to another user, or a remote
runner is selected.

At execution time, the API grants only the selected Playwright node access to
the profile. The runner receives the decrypted browser state through a sealed,
execution-bound exchange and loads it into the Playwright browser context.

## Manage a profile

Each profile shows its Environment, optional role, authentication status, last
authentication time, and known expiry.

| Action              | Effect                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| **Re-authenticate** | Replaces the stored browser state by running the manual sign-in flow again |
| **Test session**    | Restores the state in a visible browser and checks the success condition   |
| **Edit**            | Changes profile metadata or authentication settings                        |
| **Revoke**          | Immediately removes stored browser state but keeps the profile             |
| **Delete**          | Permanently removes the profile and its encrypted browser state            |

An expired, revoked, unauthenticated, or reauthentication-required profile is
disabled in the Playwright node selector until it is authenticated again.

## Security model

- Authentication happens in a visible local browser; passwords are not sent
  to or stored by Playrunner.
- Captured browser state is encrypted at rest and omitted from normal profile
  API responses.
- Profiles are isolated by owner and Environment.
- Browser state is released only for the selected node in an authorized Local
  runner execution.
- Revoking a profile removes its stored state immediately. It does not revoke
  the session at the identity provider; use the provider's account controls if
  that is also required.

Treat an Authentication Profile as a credential. Give its test account only
the permissions the workflow needs, and reauthenticate or revoke it whenever
access changes.

## Troubleshooting

| Symptom                                            | What to check                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Interactive authentication is unavailable          | Run the local API and confirm local authentication is enabled                    |
| Chrome or Chromium cannot be launched              | Install a supported browser or configure the authentication browser executable   |
| Authentication waits and then fails                | Check the success URL or selector in the browser before completing capture       |
| The profile is disabled in the Playwright selector | Authenticate it again and confirm its status is **Authenticated**                |
| The workflow requires the profile's Environment    | Add that saved Environment node and connect it to the Playwright node            |
| The runner reports the profile is unsupported      | Change the workflow runner to **Local runner**                                   |
| A previously working session fails                 | Click **Test session**, then **Re-authenticate** if the provider session expired |

For local browser configuration variables, see
[Environment variables](../local-dev/05-environment-variables.md). For general
runtime problems, see [Troubleshooting](../local-dev/09-troubleshooting.md).
