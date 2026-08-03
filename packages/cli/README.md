# playrunner CLI

Run a saved Playrunner workflow from CI/CD with a revocable machine token.

## Run a workflow

1. Open the saved workflow in Playrunner and copy its workflow ID from the URL.
   The ID is the value after `/workflows/`.
2. Open **Settings → API tokens**, create a token, and allow it to run that
   workflow.
3. Export the API token:

```text
export PLAYRUNNER_API_KEY='<your-api-token>'
```

4. Run the CLI, replacing `WORKFLOW_ID` with the workflow ID you copied:

```text
npx playrunner WORKFLOW_ID --url https://playrunner.cloud
```

For example:

```text
npx playrunner 2cc84235-58f7-4cb1-89cd-0c379d3b6908 --url https://playrunner.cloud
```

For a self-hosted or local installation, replace `https://playrunner.cloud`
with the Playrunner URL for that environment.

In CI/CD, store `PLAYRUNNER_API_KEY` in your provider's protected, masked secret
variables instead of committing it to source control. Pass the workflow ID as
the first CLI argument. The CLI never writes the token to disk or includes it in
URLs or output.

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
