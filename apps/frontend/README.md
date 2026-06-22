<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Playrunner Frontend

This package contains the Vite frontend for Playrunner. The standard local workflow does not start it directly from this folder.

## Standard Local Development

Use the repo-root startup flow instead:

1. Copy `.env.example` to `.env` at the repo root if you want to change ports before first run.
2. Run `./start-local.sh --setup` for the one-time setup flow.
3. Run `./start-local.sh` for the normal app.

The repo-root script loads the local `.env`, exports the correct proxy targets, and chooses whether to run the normal app or the dedicated setup app.

## Standalone Frontend Debugging

If you specifically want to run the frontend package by itself:

1. Install dependencies with the repo-root `./install-local.sh` or run `npm ci` in this package.
2. Optionally copy `apps/frontend/.env.example` to `apps/frontend/.env`.
3. Run `npm run dev`.

For the setup UI, use `npm exec vite -- --config ../setup/vite.config.ts` from `apps/frontend`.
