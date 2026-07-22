# @playrunner/schedule

Recurring workflow schedule configuration for Playrunner.

[![npm version](https://img.shields.io/npm/v/@playrunner/schedule.svg)](https://www.npmjs.com/package/@playrunner/schedule)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/schedule)

## Install

```bash
npm install @playrunner/schedule
```

Add the package as a direct production dependency of the Playrunner frontend and API. Schedule execution and lifecycle management remain host-managed.

## Package surfaces

- `@playrunner/schedule` exports the Schedule integration and configuration panel.
- `@playrunner/schedule/api` exports the API contribution mounted at `/api/schedule`.
- `@playrunner/schedule/e2e` exports the package-owned E2E contribution.
- The integration id is `schedule`.

```ts
import scheduleIntegration, { ScheduleConfigPanel } from "@playrunner/schedule";
import scheduleApiContribution from "@playrunner/schedule/api";
```

## Testing

Run the package checks from the repository root:

```bash
npm run format:check --prefix packages/schedule
npm run lint --prefix packages/schedule
npm run typecheck --prefix packages/schedule
npm run test:e2e:mock -- --grep @schedule
```

The E2E scenario renders Schedule in the integration catalog. It runs in
deterministic mock mode through the shared Playrunner browser harness, which
uses the real frontend, API, authentication, and dedicated E2E database. No
provider credentials are required.

## Documentation

See the [Schedule integration documentation](https://playrunner.dev/docs/integration-packages/schedule/) for recurrence fields, exports, and runtime behavior.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
