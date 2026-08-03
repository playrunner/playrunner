# playrunner CLI

Run a saved Playrunner workflow from CI/CD with a revocable machine token.

## Run a workflow

1. Open the saved workflow in Playrunner and copy its workflow ID from the URL.
   The ID is the value after `/workflows/`.
2. Open **Settings → API tokens**, create a token, and allow it to run that
   workflow.
3. Set the server URL, API token, and workflow ID in your shell:

```bash
export PLAYRUNNER_URL='https://playrunner.example.com'
export PLAYRUNNER_API_KEY='<your-api-token>'
export PLAYRUNNER_WORKFLOW_ID='<your-workflow-id>'

npx playrunner "$PLAYRUNNER_WORKFLOW_ID"
```

Use `https://playrunner.cloud` for Playrunner Cloud. For a self-hosted or local
installation, use the Playrunner URL for that environment.

In CI/CD, store `PLAYRUNNER_API_KEY` in your provider's protected, masked secret
variables instead of committing it to source control. Store the workflow ID in
a normal CI variable and pass it as the first CLI argument. The CLI never writes
the token to disk or includes it in URLs or output.

By default the command streams safe progress, waits up to 30 minutes, and exits
successfully only when the workflow completes. Use `--no-wait` to return after
the server accepts the run, `--timeout 10m` to change the deadline, or `--json`
for newline-delimited JSON output. Run `npx playrunner --help` for all options.

## Package-name acknowledgement

Our warm thanks to [Jason Rai (MisterJimson)](https://github.com/MisterJimson)
for generously transferring the `playrunner` npm package name to the current
Playrunner project. Jason's original
[MisterJimson/playrunner](https://github.com/MisterJimson/playrunner) was a
separate local Playwright YAML flow runner. This package is a fresh CLI for the
current platform and does not incorporate Jason's prior code.

## License

See [LICENSE](LICENSE).
