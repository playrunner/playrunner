---
sidebar_position: 4
title: Connect the CLI for Cloud Authentication Profiles
description: Pair a computer with Playrunner Cloud, run the authentication companion, and capture browser sessions in native Chrome.
keywords:
  - playrunner authentication companion
  - playrunner login
  - authentication profiles cloud
  - playwright browser authentication
---

# Connect the CLI for Cloud Authentication Profiles

Playrunner Cloud cannot open a browser on your computer directly. The
Playrunner CLI provides an outbound-only authentication companion that pairs
your computer with your Cloud account, opens native Chrome locally, and sends
the captured browser state back to the Authentication Profile you selected.

The companion receives only Authentication Profile capture requests. It does
not accept inbound network connections or receive your Playrunner API token.

## Requirements

You need:

- Node.js 20 or later.
- Google Chrome or a compatible Chromium browser installed on the computer
  where you will sign in.
- Playrunner CLI 0.2.5 or later.
- A signed-in account at [playrunner.cloud](https://playrunner.cloud).

Install the CLI globally on the computer that will perform authentication:

```bash
npm install --global playrunner@latest
playrunner --version
```

You do not need `PLAYRUNNER_API_KEY` for pairing or capturing an Authentication
Profile.

## Step 1 — Pair the computer

Run:

```bash
playrunner login
```

The CLI prints a short pairing code and opens the Playrunner Cloud approval
page. If the page does not open automatically, copy the URL printed in the
terminal into your browser.

1. Sign in to Playrunner Cloud if prompted.
2. Confirm that the code on the page exactly matches the code in your
   terminal.
3. Click **Approve device**.
4. Return to the terminal and wait for the paired confirmation.

For another Playrunner installation, specify its URL explicitly:

```bash
playrunner login --url https://your-playrunner.example.com
```

Pairing credentials are stored for the current operating-system user. On
macOS, secret material is stored in Keychain when available. The companion
configuration file is restricted to the current user.

## Step 2 — Connect the companion

For an interactive capture, keep this command running in a terminal:

```bash
playrunner auth connect
```

The terminal should print:

```text
Playrunner authentication companion is connected.
```

Leave that terminal open while creating or reauthenticating a profile. The
computer appears as **Online** in the **Paired devices** panel within about 30
seconds. You can click **Refresh** to update the list immediately.

## Optional advanced service mode

`playrunner auth install` is not an additional setup step and does not replace
`playrunner login`. It is an optional way to keep the companion process running
as a user-level background service:

```bash
playrunner auth install
```

For interactive captures, use the foreground `playrunner auth connect` command
so you can respond to the terminal prompt after signing in. Most users should
use only the two-step `login`, then `auth connect` flow described above.

## Step 3 — Select the device in Cloud

1. Open **Authentication Profiles** in Playrunner Cloud.
2. Find the **Paired devices** panel.
3. Confirm that your computer is marked **Online**.
4. Choose it under **Device for authentication**.

The selection is stored in that browser. If the computer is offline, run
`playrunner auth connect`, wait for the connected message, and refresh the
device list.

## Step 4 — Capture an Authentication Profile

Create a profile as described in the
[Authentication Profiles tutorial](../tutorials/06-authentication-profiles.md),
then:

1. Click **Authenticate** on the profile.
2. Wait for Chrome to open on the paired computer.
3. Complete the normal sign-in flow, including single sign-on or multifactor
   authentication when required.
4. Confirm that the configured success URL or element is present.
5. Leave Chrome open and return to the companion terminal.
6. Press **Enter** in the terminal.
7. Wait for `Authentication Profile capture completed.` in the terminal and
   for the Cloud profile status to become **Authenticated**.

If the success condition is not satisfied, capture fails without replacing a
previously stored session. Correct the profile's success condition or finish
sign-in, then authenticate again.

## Check or disconnect a device

Check whether the current computer is paired and recently online:

```bash
playrunner auth status
```

Stop the installed service, revoke the device in Cloud, and delete its local
pairing credentials:

```bash
playrunner auth disconnect
```

You can also revoke another computer with the trash button in the **Paired
devices** panel. Revocation prevents that device from receiving new capture
requests. Run `playrunner login` again if you later want to pair it again.

## After capture

The CLI is needed only to capture or refresh an Authentication Profile. After
the profile becomes **Authenticated**, you may stop `playrunner auth connect`
and turn off the paired computer.

Cloud **Test session** checks and Hosted Runner workflows run remotely. The
Hosted Runner receives the stored state through a short-lived,
execution-bound handoff; it does not contact the companion or open a browser on
your computer.

## Troubleshooting

| Symptom                              | What to do                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `playrunner: command not found`      | Install the CLI globally, then open a new terminal.                                                 |
| The pairing code expires             | Run `playrunner login` again and approve the new code.                                              |
| The device shows **Offline**         | Run `playrunner auth connect`, leave it running, and refresh the device list.                       |
| Chrome does not open                 | Install Chrome or Chromium on the paired computer and retry.                                        |
| Capture waits indefinitely           | Return to the companion terminal and press **Enter** after sign-in is complete.                     |
| Capture reports a validation failure | Make sure the configured success URL or selector is present before pressing **Enter**.              |
| The wrong computer opens Chrome      | Select the intended online device in the **Paired devices** panel before clicking **Authenticate**. |
| The device is revoked                | Run `playrunner auth disconnect`, then pair it again with `playrunner login`.                       |
