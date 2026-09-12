# Playrunner plugin for Codex

The plugin combines a hosted MCP connection to `https://playrunner.cloud/mcp`
with a Codex skill for guided workflow setup. Publisher: **Concept AI PTY LTD**;
OpenAI project: **Playrunner**.

Users connect their Playrunner Cloud account, then ask Codex to create projects,
environments, Authentication Profiles and Playwright workflows, connect GitHub,
run workflows and inspect results. Cloud account onboarding and usage limits apply.
The skill handles local companion setup when a test needs a browser sign-in.
It uses the published `playrunner@0.2.5` through npm's cache; no global Playrunner
installation or manual MCP configuration is required.

## Build and check

From the Playrunner repository root:

```bash
npm ci --prefix apps/plugin
npm run plugin:check
npm run plugin:package
npm run verify:cli --prefix apps/plugin
```

Packaging requires Node.js 20+, npm, `tar` and `zip`. It creates:

- `apps/plugin/dist/playrunner-plugin-0.1.0.tar.gz`: a local marketplace archive
  containing the plugin, skill, pinned CLI launcher and `.mcp.json`.
- `apps/plugin/dist/playrunner-plugin-0.1.0/`: its unpacked marketplace.
- `apps/plugin/dist/playrunner-0.1.0-submission.zip`: a portable plugin upload,
  excluding local MCP configuration.
- `apps/plugin/dist/playrunner-skill-0.1.0.zip`: the self-contained skill upload for
  the OpenAI **With MCP** submission. The hosted endpoint is registered separately
  in the portal; this ZIP includes the launcher and its runtime pin inside the skill.

The package allowlist excludes credentials, development tests, node_modules,
submission records and generated files. The launcher preserves arguments and
exit status without invoking a shell.

## Install and run in Codex

After the hosted OAuth/MCP changes have been deployed and verified:

```bash
npm run plugin:install
```

This registers the generated local marketplace and installs `playrunner@playrunner`
in the current user's Codex configuration. Complete the Playrunner OAuth connection
in Codex, then start a new local task and ask:

```text
Use Playrunner to set up a workflow for my staging checkout tests.
```

The user signs in or creates a Cloud account. Codex can create the workflow through
MCP. When browser authentication is needed, it checks Node/npm, downloads the pinned
CLI with normal command approval, pairs the computer through a browser code and
starts `auth connect` in a retained terminal. Users enter passwords and MFA directly
in their browser. Hosted MCP operations do not require the CLI.

A local marketplace install does not make a plugin publicly searchable. Rebuilds
are cached by Codex; use the plugin-creator cachebuster/reinstall flow for development
updates. Do not manually edit installed cache files. The bundle includes portable
`mcp.json` wiring and the legacy `.mcp.json` compatibility configuration.

## Hosted service and public submission

The companion Cloud change lives in `playrunner-cloud/services/cloud-api/src/mcp-*.ts`.
It includes OAuth/OIDC discovery, consent, PKCE, rotating refresh tokens, scoped
MCP tools and a gateway delegation boundary that retains Cloud account and quota
checks. The OAuth database migration and hosting rewrites must be deployed before
public submission. The browser consent page is `/connect/codex`.

After deployment, run:

```bash
npm run verify:hosted --prefix apps/plugin
```

This read-only probe checks production discovery and the unauthorized MCP challenge.
It does not substitute for a real account login and workflow smoke test.

Open the [OpenAI plugin portal](https://platform.openai.com/plugins), select
Concept AI PTY LTD → Playrunner, and choose **Create plugin → With MCP**. Use
`submission/listing.json` and `submission/test-cases.json` for the listing and review
cases, upload the skill ZIP under Skills, and register the universal hosted URL.
Complete domain verification using the portal's exact challenge token, scan the
production tools, supply reviewer access and confirm availability/attestations.

As of 12 September 2026, the Cloud migration, gateway and hosting are deployed,
Concept AI PTY LTD and the domain are verified, and OpenAI has scanned the tools
and skill. Two actual Codex workflow runs passed, including the dedicated reviewer
account: each reported one passing Playwright test and zero failures. The reviewer
workspace has sample projects, environment, profile and workflow data. Reviewer
credentials are stored privately in the portal, never in this repository.

The [demo walkthrough](https://playrunner.cloud/plugin-demo/) includes live Cloud
captures and the recorded Codex result. Publisher declarations, OpenAI review and
public publication remain pending. This bundle is not yet publicly searchable.

From the Cloud repository, preview the ordered migration, gateway and hosting
release with `npm run deploy:mcp`. After reviewing and committing the changes,
`npm run deploy:mcp -- --execute` performs that deployment. Run it only after
explicit production-deployment approval; it does not push Git or publish the plugin.

OpenAI review precedes publication. Once approved, publish in the portal to make
Playrunner searchable in the public Plugins Directory shared by Codex and ChatGPT.
See the [official submission process](https://developers.openai.com/plugins/deploy/submission).
