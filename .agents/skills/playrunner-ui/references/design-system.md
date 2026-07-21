# Playrunner UI Design System Reference

## Source Of Truth

- `apps/frontend/src/pages/DesignSystem.tsx`
- `apps/frontend/src/components/ui/Button.tsx`
- `apps/frontend/src/components/ui/Input.tsx`
- `apps/frontend/src/components/ui/Badge.tsx`
- `apps/frontend/src/index.css`
- `apps/setup/src/index.css`

`apps/setup/src/index.css` imports `../../frontend/src/index.css`, so setup screens should use the same tokens and primitives as the main web app.

## Layout

- Use `min-h-screen bg-background text-foreground font-sans`.
- Use `max-w-7xl mx-auto` on the top-level standard document page container, with page padding on that same container, so Projects, Environments, Integrations, Insights, Teams, Settings, and the Design System use a consistent content width.
- Use vertical section rhythm such as `space-y-6`, `space-y-8`, or `space-y-16`.
- Use section headers with `border-b border-subtle pb-2` or `pb-6`.
- Prefer standard product cards over bespoke hero compositions.
- Let standard document pages scroll with the browser. Avoid page-level `overflow-y-auto`, `overflow-auto`, or `h-screen overflow-hidden`; reserve inner vertical scroll containers for fixed interactive surfaces such as editor canvases, modal bodies, dropdowns, and log panels.

## Surfaces

- Primary page cards: `bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm`.
- Nested/inset cards: `bg-[var(--background)] border border-[var(--border)] rounded-xl`.
- Interactive or code-adjacent surfaces: `bg-[var(--surface-hover)] border border-[var(--border)]`.
- Use `hover:border-[var(--border-strong)]` for interactive cards when needed.
- Avoid custom dark panels, high-contrast gradients, or white-on-navy one-offs on setup/product screens unless the whole product already uses them.

## Typography

- Page title: `text-3xl font-semibold tracking-tight`.
- Section title: `text-xl font-medium`.
- Labels: `text-sm font-medium`.
- Supporting copy: `text-sm text-muted leading-relaxed`.
- Eyebrows/meta labels: `text-xs font-semibold uppercase tracking-wider text-muted`.
- Commands, env vars, and file paths: `font-mono text-xs`.

## Controls

- Use the shared `Button` variants instead of page-local button styling.
- Use `Input` for text fields and keep labels directly above controls with tight spacing.
- Use `Badge` for status and small state chips.
- For icon containers inside cards, use compact inset surfaces like `h-8 w-8` or `h-9 w-9`, `rounded-lg`, `bg-[var(--surface-hover)]`, `border border-[var(--border)]`.

## Code And Command Blocks

- Use bordered inset blocks, not black translucent overlays:
  `rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 font-mono text-xs text-[var(--foreground)]`

## Setup-Specific Guidance

- Treat setup as a product workflow, not a launch splash page.
- Use the same forms, cards, muted copy, and status badges as the Design System page.
- Match all integration connection-dialog instruction and setup-guide callouts to GCP and GitHub. Use an outer `rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left` surface with an `items-start gap-3` row. Place `BookOpen` at `h-4 w-4 text-muted` inside a `h-8 w-8 shrink-0 rounded-lg` inset container using the standard border and background tokens. Render the title as `text-sm font-medium`, the description as `mt-1 text-xs leading-relaxed text-muted`, and the guide anchor as `mt-3 inline-flex items-center gap-1.5 text-xs font-medium` with the standard underline and hover treatment. End the label with `ExternalLink` at `h-3.5 w-3.5`, and set `target="_blank"` plus `rel="noopener noreferrer"`.
- If a setup screen currently uses a bespoke hero, gradient, or white-on-dark panel, replace it with normal surface cards unless there is a strong repo-local reason not to.

## Anti-Patterns

- Do not invent page-local button classes when a shared `Button` variant already fits.
- Do not hard-code slate/white/dark palette values for product pages when theme tokens already exist.
- Do not mix marketing-style hero sections with system-style forms in the same flow.
- Do not use large custom radii or heavy shadows by default when the system uses `rounded-xl` and `shadow-sm`.
