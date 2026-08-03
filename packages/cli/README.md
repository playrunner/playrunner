# playrunner CLI

Run a saved Playrunner workflow from CI/CD with a revocable machine token.

```bash
PLAYRUNNER_URL=https://playrunner.example.com \
PLAYRUNNER_API_KEY=pr_live_xxx \
npx playrunner 2cc84235-58f7-4cb1-89cd-0c379d3b6908
```

Create an API token in Playrunner under **Settings → API tokens** and store it
in your CI provider's protected, masked secret variables. The CLI never writes
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
