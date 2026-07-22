# @playrunner/schedule

Recurring workflow schedule configuration for Playrunner.

[View package on npm](https://www.npmjs.com/package/@playrunner/schedule)

## Install

```bash
npm install @playrunner/schedule
```

Add the package as a direct production dependency of the Playrunner frontend and API. Schedule execution and lifecycle management remain host-managed.

## Package surfaces

- `@playrunner/schedule` exports the Schedule integration and configuration panel.
- `@playrunner/schedule/api` exports the API contribution mounted at `/api/schedule`.
- The integration id is `schedule`.

```ts
import scheduleIntegration, { ScheduleConfigPanel } from '@playrunner/schedule';
import scheduleApiContribution from '@playrunner/schedule/api';
```

## Documentation

See the [Schedule integration documentation](https://playrunner.dev/docs/integration-packages/schedule/) for recurrence fields, exports, and runtime behavior.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
