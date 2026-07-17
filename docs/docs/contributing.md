---
sidebar_position: 2
title: Contributing
---

# Contributing to Playrunner

Playrunner is an early developer tool project for Playwright orchestration. The
most useful contributions improve how teams run, debug, analyse, and maintain
end-to-end test automation.

## Good places to start

- Frontend and UX: workflows, run status, traces, reports, and result views.
- Runners: execution, scheduling, retries, output handling, and analysis.
- Integrations: package-owned frontend, API, and Orchestrator contributions for
  GitHub, Jira, Slack, CI/CD systems, and other providers. Start with the
  [integration development guide](./local-dev/integrations/index.md).
- Documentation: setup paths, examples, architecture notes, and troubleshooting.
- e2e testing: failure summaries and suggested fixes.
- Playrunner AI Assistant: a grounded assistant that explains integrations, workflows, and site behavior from real project data.

## First steps

1. Run the project locally with the
   [Getting Started tutorial](./tutorials/01-getting-started.md).
2. Read the open issues and pick a small, well-scoped task.
3. Open a pull request with the smallest useful change and a clear explanation.

## Documentation examples

Format documentation and every fenced code example with the repository
Prettier rules in `docs/.prettierrc.json`. JavaScript, TypeScript, and TSX use
single quotes; JSON remains valid JSON and therefore uses double quotes. Always
add the appropriate language tag to a code fence and keep source tokens as plain
code rather than Markdown emphasis.

From `docs/`, validate documentation formatting with:

```bash
npm run format:check
```

## Contributor License Agreement

By submitting a contribution, you agree to the repository root
[Contributor License Agreement](https://github.com/playrunner/playrunner/blob/main/CONTRIBUTOR_LICENSE_AGREEMENT.md).

If you are not sure where to start, open a GitHub discussion and describe the
area you want to work on.
