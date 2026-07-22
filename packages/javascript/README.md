# @playrunner/javascript

JavaScript workflow-node configuration for Playrunner.

[View package on npm](https://www.npmjs.com/package/@playrunner/javascript)

## Install

```bash
npm install @playrunner/javascript
```

Add the package as a direct production dependency of the Playrunner frontend and API. This release provides the configuration UI and API contribution; JavaScript execution is not yet implemented in the orchestrator.

## Package surfaces

- `@playrunner/javascript` exports the JavaScript integration and configuration panel.
- `@playrunner/javascript/api` exports the API contribution mounted at `/api/javascript`.
- The integration id is `code`.

```ts
import javascriptIntegration, {
  JavascriptConfigPanel,
} from '@playrunner/javascript';
import javascriptApiContribution from '@playrunner/javascript/api';
```

## Documentation

See the [JavaScript integration documentation](https://playrunner.dev/docs/integration-packages/javascript/) for current execution status, exports, and build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
