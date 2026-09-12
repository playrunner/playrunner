# Hosted MCP implementation status

The implementation uses a hosted Cloud MCP server plus an optional local browser
companion. The earlier proposal to eliminate every local component is superseded:
Codex may download and start the pinned CLI with normal command approval when an
Authentication Profile needs a native browser sign-in.

Implemented in the Cloud repository:

- OAuth authorization-code flow with S256 PKCE, exact registered callbacks,
  resource binding, explicit consent, expiring access tokens, rotating refresh
  tokens, replay revocation, OIDC discovery, signed ID tokens and verified email.
- Durable OAuth records in the Cloud database, plus the migration and host rewrites.
- Account, project, environment, profile, device, GitHub, workflow and execution
  tools. Environment writes preserve secret entries and omit variable values from
  responses. Browser-session payloads expose a metadata allowlist.
- MCP operations re-enter the existing gateway routes with a short-lived request
  delegation bound to the actor, method, path and body. Cloud onboarding, quotas,
  upstream authorization and existing companion checks remain in the request path.
- A consent page using existing Cloud login and Playrunner UI components.
- Tests for OAuth lifecycle, scope enforcement, owner binding, secret preservation,
  graph validation and gateway quota enforcement.

Production validation on 12 September 2026 completed the database migration,
gateway and hosting deployments, domain verification, OAuth connection from Codex
and OpenAI's scanner, and two real Codex Cloud workflow runs. Both runs reported
one passing Playwright test and zero failures. The dedicated reviewer account is
onboarded with sample data; account isolation and secret-write rejection were
checked through production MCP. API tests: 69 passing; frontend tests: 33 passing.
The Playrunner directory and composer icons are configured for both themes.

Remaining release work: publisher declarations, OpenAI review and publication.
The demo account has no GitHub installation or paired companion. Its supplied
review cases test GitHub authorization handoff and profile configuration; they do
not claim a completed third-party GitHub authorization or native browser capture.

Additional package-specific integration configuration can use the existing graph
and its package-owned UI. The initial MCP catalog includes a Playwright/environment
starter guide; it does not claim a full machine-readable schema for every third-party
integration or automatically push repository changes.
