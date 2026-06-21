# Playrunner Design System Reference

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
- Prefer centered containers like `max-w-4xl` to `max-w-6xl` with `mx-auto`.
- Use vertical section rhythm such as `space-y-6`, `space-y-8`, or `space-y-16`.
- Use section headers with `border-b border-subtle pb-2` or `pb-6`.
- Prefer standard product cards over bespoke hero compositions.

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
- If a setup screen currently uses a bespoke hero, gradient, or white-on-dark panel, replace it with normal surface cards unless there is a strong repo-local reason not to.

## Anti-Patterns

- Do not invent page-local button classes when a shared `Button` variant already fits.
- Do not hard-code slate/white/dark palette values for product pages when theme tokens already exist.
- Do not mix marketing-style hero sections with system-style forms in the same flow.
- Do not use large custom radii or heavy shadows by default when the system uses `rounded-xl` and `shadow-sm`.
