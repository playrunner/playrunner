# Playrunner Package E2E Architecture

## Contents

1. Architecture and ownership
2. Package metadata and shared contract
3. POM, data, and scenario rules
4. Core harness and discovery
5. Authentication, database, and provider fixtures
6. Selectors and accessibility
7. Test levels and provider boundaries
8. CI and isolation
9. Package implementation checklist
10. Risks and definition of done

## 1. Architecture and ownership

Use one composed browser harness for the installed Playrunner frontend while
keeping provider-specific knowledge inside each integration package.

```text
Integration package
  ├── production frontend/API/orchestrator contributions
  └── E2E contribution
        ├── package POM
        ├── deterministic dataset factory
        └── package scenarios
                     │
                     ▼
Core frontend E2E harness
  ├── starts the frontend
  ├── starts the real Playrunner API and dedicated database schema
  ├── provides authenticated state and provider-boundary fakes
  ├── supplies the host POM
  ├── discovers installed package E2E contributions
  ├── registers package scenarios as Playwright tests
  └── produces reports, traces, screenshots, and video
```

The core owns:

- Browser and web-server lifecycle.
- Authentication state.
- Real Playrunner API/database lifecycle and per-test cleanup.
- Projects, integrations, editor, and other host POMs.
- Build-time discovery and runtime contribution validation.
- Playwright configuration, projects, retries, and reporters.
- Per-test or per-worker isolation and cleanup.

The package owns:

- Selectors and actions for its settings modal or config panel.
- Valid, invalid, empty, and edge-case sample data.
- Field validation, persistence, disconnect, and package error expectations.
- Deterministic fake-upstream behaviour when provider traffic is involved.
- Optional protected live-provider scenarios.

Do not make packages duplicate core navigation, login, project creation,
browser setup, frontend startup, database setup, or reporting.

## 2. Package metadata and shared contract

Declare the test surface beside the production surfaces:

```json
{
  "playrunner": {
    "integration": {
      "id": "example",
      "frontend": ".",
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

Never re-export E2E code from `.`, `./frontend`, `./api`, or
`./orchestrator`. Production composition must not import the E2E surface.

Use `@playrunner/integration-sdk/e2e` for:

- `PlayrunnerE2EContribution`
- `PlayrunnerE2EDataContext`
- `PlayrunnerE2EHost`
- `PlayrunnerE2EPomContext`
- `PlayrunnerE2EScenario`
- `definePlayrunnerE2EContribution`

The contribution id must equal `playrunner.integration.id`. Scenario ids must
be non-empty and unique within the contribution. Module evaluation must remain
synchronous and side-effect free so Playwright can discover tests reliably.

Packages export scenario functions, not Playwright tests. The core owns the
`test` object and passes `expect` into each scenario. Packages must not launch a
browser, create a context, start services, reset databases, or register hooks.

## 3. POM, data, and scenario rules

### POM

Create a POM around the package-owned UI and compose `PlayrunnerE2EHost`:

```ts
export class ExampleE2EPom {
  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {}

  async open() {
    await this.host.openIntegration({ id: "example", name: "Example" });
  }
}
```

Expose meaningful user actions and important locators. Do not expose or repeat
host-navigation mechanics. Keep assertions in scenarios unless a reusable POM
operation must wait for a stable end state.

### Data

Export a factory, not one shared mutable object:

```ts
export function createExampleE2EData({ runId }: PlayrunnerE2EDataContext) {
  return {
    resourceName: `playrunner-e2e-${runId}`,
    token: `fake-e2e-${runId}`,
  };
}
```

Generate unique values from `runId` and optionally `workerIndex`. Keep ordinary
config separate from secrets, do not include real credentials, and never rely
on records created by another scenario. Prefer serializable data.

### Scenarios

Each scenario needs an id, title, `mode: 'mock' | 'live'`, optional tags, and an
async `run` function. One scenario should prove one coherent user journey and
clean up its state.

The first deterministic scenario for a connection-oriented package should
normally verify:

1. The integration is discoverable in the composed frontend.
2. Its settings dialog opens.
3. Accessible labels and security-sensitive input types are correct.
4. The primary action is disabled for empty input.
5. Valid sample data can be saved.
6. Connected state renders.
7. Connected state survives a page reload.
8. Disconnect returns the package to an unconfigured state.

Add validation, provider errors, config-panel persistence, and workflow
execution in separate scenarios when those behaviours exist.

## 4. Core harness and discovery

Keep the core harness under `apps/frontend/e2e` so it tests the frontend's real
direct dependency composition:

```text
apps/frontend/
  playwright.config.ts
  e2e/
    fixtures.ts
    contribution-registry.ts
    core/
      PlayrunnerHostPom.ts
    generated/
      package-e2e-contributions.ts
    specs/
      package-contributions.spec.ts
```

The API-side launcher lives at `apps/api/src/e2e/start.ts`. It prepares the
dedicated database schema, seeds local authentication, and starts the ordinary
API entrypoint on the E2E port.

Extend `infra/scripts/generate-integration-composition.mjs` with the `e2e`
surface. The generator must:

1. Read direct `dependencies` and `optionalDependencies`.
2. Resolve installed package manifests.
3. select packages declaring `playrunner.integration.e2e`.
4. Validate the id and exact exported subpath.
5. Emit deterministic static imports.
6. Reject duplicate ids and missing or types-only exports.
7. Skip missing optional dependencies and fail for missing required ones.
8. Avoid runtime installation or provider scanning.

Generate before Playwright starts test discovery. Ignore the generated source
in Git just like other generated integration composition files.

Validate imported contributions before test registration. Require matching
ids, data and POM factories, at least one scenario, valid scenario ids/titles,
async-compatible run functions, and no duplicate scenario keys.

The generic spec loops over discovered contributions and scenarios, creates a
run id from Playwright `testInfo`, creates data and a POM, and calls the package
scenario with `{ data, expect, host, page, pom }`.

## 5. Authentication, database, and provider fixtures

For every frontend/package scenario, run the real Playrunner API against the
dedicated `playrunner_e2e` PostgreSQL schema. Log in through the real local-auth
endpoint, inject the returned session before app code runs, and clear records
through authenticated API calls before and after each test.

The browser must exercise the real routes, including:

- `GET /api/auth/session`
- `GET /api/store/integrations`
- `GET /api/store/integrations/:id`
- `PUT /api/store/integrations/:id`
- `DELETE /api/store/integrations/:id`
- Required cloud-credential reads for the integrations page.

The API launcher derives a dedicated schema from `DATABASE_URL`, applies the
Prisma schema, clears stale test state, and seeds local auth. It must never
reset or migrate the developer's default application schema.

For database-backed E2E:

- Use a dedicated PostgreSQL database or unique schema.
- Seed known local-auth data.
- Use health checks instead of sleeps.
- Tear down processes and state on success, failure, and interruption.
- Prefer direct test data drivers over production-visible reset endpoints.
- If a control endpoint is unavoidable, require explicit E2E mode, a per-run
  secret, local binding, and startup refusal in production mode.

Use Playwright storage state or per-worker auth for broader suites. Never
commit auth state because it can contain impersonation credentials.

Mock mode still traverses the real browser, API, encryption, and database
boundaries. Only third-party OAuth, token, webhook, or provider API traffic may
be faked. Live mode uses protected provider credentials, is tagged `@live`, and
must be selected explicitly with `PLAYRUNNER_E2E_MODE=live`.

## 6. Selectors and accessibility

Prefer, in order:

1. `getByRole` with an accessible name.
2. `getByLabel` for fields.
3. Stable user-visible text.
4. Namespaced `data-testid` for ambiguous canvas or generic host elements.

Make interactive containers real buttons or links where appropriate. Give
icon-only buttons accessible labels. Give modals `role="dialog"`,
`aria-modal="true"`, and a labelled title.

Host selectors may use stable integration ids such as
`integration-card-openai`. Package POMs own provider-specific field, link, and
status locators. Do not use Tailwind classes, generated classes, XPath tied to
DOM position, or nth-child selectors.

## 7. Test levels and provider boundaries

### Level 1: contract smoke

Run on every pull request:

- Contribution imports and id validation.
- Integration name, description, and icon render.
- Settings modal or config panel opens.
- Required accessible labels exist.
- No package-load console errors.

### Level 2: deterministic mock-provider scenarios

Run on every pull request:

- Required and invalid field validation.
- Save, reload, persistence, disconnect, and error states.
- Node configuration persistence.
- Package API behaviour through the real API and deterministic provider fakes.
- Successful and failed fake-upstream responses.
- Local workflow execution where deterministic.

`page.route` intercepts browser requests only. It cannot intercept an API or
orchestrator process calling a provider. For server-side provider calls, inject
a provider client/base URL or run a fake upstream service.

### Level 3: live provider

Keep optional and non-blocking for normal pull requests:

- Tag `@live`.
- Skip when required secrets are absent.
- Run only in protected CI or manually.
- Use dedicated test tenants and least-privilege credentials.
- Avoid destructive operations and clean up remote resources.
- Never expose secrets to forked pull requests, logs, traces, or screenshots.

Browser E2E complements package unit tests, API integration tests,
orchestrator tests, lint, typecheck, and builds. It does not replace them.

## 8. CI and isolation

Start pull-request coverage with Chromium, one worker, deterministic Level 1
and Level 2 scenarios, one CI retry, trace on first retry, and screenshot/video
on failure. Produce line, HTML, and JUnit reports.

Add parallelism only after each worker receives isolated accounts, schemas, or
ownership-based cleanup. Include `workerIndex` in data factories. Never depend
on scenario order.

Run Firefox, WebKit, longer workflow execution, and eligible live scenarios in
nightly or manual jobs. Support package filtering through tags such as
`@openai` and `@integration`.

## 9. Package implementation checklist

- [ ] Add `playrunner.integration.e2e` metadata.
- [ ] Add an exact `./e2e` export with all runtime/type conditions.
- [ ] Include E2E source in the package tarball.
- [ ] Add optional Playwright peer and matching development dependency.
- [ ] Add the SDK E2E TypeScript path where local source paths are used.
- [ ] Add POM, data factory, scenarios, and default contribution.
- [ ] Use the host POM for core navigation.
- [ ] Declare each scenario's mock or live provider mode.
- [ ] Use unique fake data and no real credentials in mock mode.
- [ ] Add accessible selectors to production UI only where needed.
- [ ] Generate and inspect the contribution registry.
- [ ] Run generator tests.
- [ ] Run SDK and package typecheck, lint, format, and package tests.
- [ ] Run frontend typecheck, lint, build, and targeted E2E.
- [ ] Run `npm pack --dry-run --json` for publishable export changes.
- [ ] Run `git diff --check`.

The OpenAI package is the canonical first example: it exports a package POM,
run-id-based fake API-key data, and a deterministic scenario covering connect,
reload, and disconnect through the real API and dedicated E2E database schema.

## 10. Risks and definition of done

Mitigate production bundle contamination with exact E2E exports and a test-only
generated registry. Mitigate Playwright version duplication by letting the
harness own the runtime and packages use compatible optional peers. Mitigate
flaky data with per-test drivers and run ids. Mitigate overcoupled POMs by
requiring host composition. Mitigate fragile selectors with semantic locators.
Mitigate unsafe reset controls by avoiding production-visible test endpoints.
Mitigate provider cost and availability with fake upstreams and protected live
jobs.

A package E2E slice is done when:

- The core command starts the required frontend and runs reproducibly.
- Discovery comes from installed direct dependencies.
- Production surfaces do not import E2E code.
- The package scenario passes locally and is filterable by tag.
- Data and API state are isolated and order-independent.
- Failure artifacts are useful and ignored by Git.
- Relevant generator, SDK, package, frontend, and browser checks pass.
- Live tests, if any, are explicitly tagged and protected.
