---
sidebar_position: 2
title: Package E2E Contributions
description: Add package-owned data, page objects, and Playwright scenarios to the shared Playrunner harness.
---

# Package E2E Contributions

An integration package owns the browser behavior specific to its provider. The
core frontend owns only the reusable environment: application startup, package
discovery, browser lifecycle, host navigation, real API/database lifecycle,
authentication, cleanup, provider-mode selection, and reporting.

| Owner               | Responsibility                                                               |
| ------------------- | ---------------------------------------------------------------------------- |
| Integration package | Provider test data, selectors, POM actions, assertions, and scenarios        |
| Core E2E harness    | Discovery, Vite/API startup, database isolation, auth, host POM, and cleanup |

## Package layout

Add an `e2e` directory alongside the package's other surfaces:

```text
packages/example/
├── package.json
└── src/
    └── e2e/
        ├── ExampleE2EPom.ts
        ├── data.ts
        └── index.ts
```

The POM class name is package-local and can be descriptive. Core never imports
it by name. Discovery loads the package's default `./e2e` contribution, and
that contribution's `createPom` function creates the correct POM.

## Declare the E2E surface

Add `e2e` to `playrunner.integration` and export the matching entrypoint:

```json
{
  "playrunner": {
    "integration": {
      "id": "example",
      "e2e": "./e2e"
    }
  },
  "exports": {
    "./e2e": {
      "types": "./src/e2e/index.ts",
      "import": "./src/e2e/index.ts",
      "require": "./src/e2e/index.ts",
      "default": "./src/e2e/index.ts"
    }
  }
}
```

Declare `@playwright/test` as a development dependency and as an optional peer
dependency. This makes the browser types available to package authors without
forcing Playwright into production consumers. The package also needs access to
`@playrunner/integration-sdk/e2e`.

## Create deterministic data

Generate unique, fake values from the supplied run context. Do not read
developer credentials or call the real provider:

```ts
import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface ExampleE2EData {
  apiKey: string;
}

export function createExampleE2EData({
  runId,
}: PlayrunnerE2EDataContext): ExampleE2EData {
  return { apiKey: `example-e2e-${runId}` };
}
```

## Create the package POM

Prefer accessible roles, labels, and names. Use a stable `data-testid` only
where a semantic selector cannot uniquely identify a host element.

```ts
import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class ExampleE2EPom {
  readonly dialog: Locator;
  readonly apiKeyInput: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Connect to Example' });
    this.apiKeyInput = this.dialog.getByLabel('API key');
  }

  async open() {
    await this.host.openIntegration({ id: 'example', name: 'Example' });
  }
}
```

Package POMs should express provider-specific interactions. Put shared
navigation such as opening the Integrations page in the core host POM instead
of duplicating it in every package.

## Export scenarios

Default-export one contribution whose ID matches the package manifest:

```ts
import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createExampleE2EData } from './data';
import { ExampleE2EPom } from './ExampleE2EPom';

const exampleE2EContribution = definePlayrunnerE2EContribution({
  id: 'example',
  createData: createExampleE2EData,
  createPom: ({ host, page }) => new ExampleE2EPom(page, host),
  scenarios: [
    {
      id: 'connect',
      mode: 'mock',
      title: 'connects an Example API key',
      tags: ['@example', '@integration'],
      async run({ data, expect, pom }) {
        await pom.open();
        await pom.apiKeyInput.click();
        await pom.apiKeyInput.fill(data.apiKey);
        await expect(pom.dialog).toBeVisible();
      },
    },
  ],
});

export default exampleE2EContribution;
```

The composition generator reads direct dependencies of the frontend harness,
validates each package's metadata and runtime export, and writes static imports
to `apps/frontend/e2e/generated/package-e2e-contributions.ts`. Do not edit that
generated file. Selecting the package as a direct frontend dependency is what
makes its E2E contribution discoverable.

## Scenario boundaries

Keep package scenarios independent and safe to run in parallel:

- derive data from the provided run context;
- begin from a known browser state and avoid ordering dependencies;
- test user-visible behavior rather than private component implementation;
- never put real API keys or secrets in datasets, traces, or screenshots;
- always use the real browser-facing Playrunner API and dedicated E2E database;
- fake only the outbound provider boundary in mock mode; and
- use an injectable provider client or server-side fake upstream because
  `page.route` cannot intercept HTTP initiated by the API or Orchestrator.

The default deterministic suite proves frontend package composition, local
authentication, API behavior, encrypted persistence, and user flows. It is not
a live provider contract test and does not prove that a third-party credential
works.

## Choose the provider mode

Every scenario declares exactly one provider mode:

- `mode: 'mock'` is the default pull-request path. It uses fake package data and
  deterministic provider responses while retaining the real Playrunner stack.
- `mode: 'live'` is optional, secret-gated, and selected explicitly. It calls
  the real provider from protected CI or a manual developer run.

Keep live-provider credentials out of package datasets and browser fields when
failure artifacts could capture them. Live scenarios must use dedicated test
tenants, least-privilege access, safe operations, and remote cleanup.

## Verify a package

Run the package checks, composition tests, filtered browser suite, and affected
frontend checks:

```bash
npm --prefix packages/example run format:check
npm --prefix packages/example run lint
npm --prefix packages/example run typecheck

npm run test:integration-composition
npm run test:e2e:mock -- --grep @example

# Only when the package contributes a protected live scenario:
npm run test:e2e:live -- --grep @example

npm --prefix apps/frontend run lint
npm --prefix apps/frontend run typecheck
npm --prefix apps/frontend run build
git diff --check
```

The OpenAI package is the reference implementation under
`packages/openai/src/e2e`, and its provider documentation includes the exact
[OpenAI E2E workflow](../integration-packages/openai.md#end-to-end-test).
