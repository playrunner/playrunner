# @playrunner/resend

Resend integration package for Playrunner. It contributes one Resend workflow
node with `send` and `wait` operations, plus frontend, API, orchestrator, and
package-owned E2E surfaces.

## Install

```bash
npm install @playrunner/resend
```

The consuming Playrunner apps discover each declared surface from the package
metadata at build time.

See the [Resend integration documentation](https://playrunner.dev/docs/integration-packages/resend/)
for authentication, sending and receiving setup, node configuration, and
workflow outputs.
