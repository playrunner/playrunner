# Playrunner UI Design System Reference

## Source Of Truth

- `apps/frontend/src/pages/DesignSystem.tsx`
- `apps/frontend/src/components/ui/Button.tsx`
- `apps/frontend/src/components/ui/Input.tsx`
- `apps/frontend/src/components/ui/FilePicker.tsx`
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

## Instruction Callouts

- Every instructional callout or instruction box includes a visible Lucide icon to the left of its copy. A bordered rectangle containing instructional text without an icon is incomplete.
- Use `Info` for general instructions, `BookOpen` for setup or documentation guidance, and a matching semantic icon for warning, error, or success states.
- For a compact general instruction, use `flex items-start gap-3 rounded-lg border border-subtle bg-[var(--surface-hover)] p-3 text-muted shadow-inner`, with a decorative `h-4 w-4` icon marked `aria-hidden="true"` and `text-xs leading-relaxed` copy.
- Keep the icon visible at narrow widths with `shrink-0`. Use the standard inset icon container for larger setup-guide callouts.

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
- For integration authentication choices, use the Slack-style segmented control: a `flex gap-2 border-b border-subtle pb-2` group with compact `rounded-lg px-3 py-1.5 text-xs font-medium` buttons. Select the action-oriented OAuth/provider option by default when available. Active options use `bg-[var(--accent)] text-[var(--accent-foreground)]`, which appears dark in the light theme and white in the dark theme; inactive options use `text-muted hover:text-[var(--foreground)]`. Add a group label and `aria-pressed` states.

## File Pickers

- Use `FilePicker` from `apps/frontend/src/components/ui`; the Design System page has an interactive example and a disabled state. `WorkflowTestPlanPanel.tsx` shows validation and replacement of an attached plan.
- The canonical treatment is a shared secondary `Button`, default size, `gap-2`, and a decorative Lucide `Upload` icon at `h-4 w-4`. The native file input is hidden and opened by the button. The row wraps with `flex flex-wrap items-center gap-3`; the optional hint uses `text-xs text-muted` and is linked to the button with `aria-describedby`.
- Supply an action-specific `ariaLabel` for the input, `accept` for the file chooser filter, and a hint naming the supported format and actual size limit. Use `Choose file` initially and a contextual replacement label such as `Replace plan` when a file is attached. Display the filename separately with wrapping where needed.
- `onFileSelected(file)` runs only when a file was selected. The primitive clears the native input so selecting the same file again works; cancelling leaves caller state unchanged. Pass `disabled` while selection is unavailable; native disabled fieldsets also apply.
- The caller owns file validation, reading/uploading, loading and error states, and the selected filename. The `accept` attribute is only a chooser filter, not validation. Preserve existing domain-specific checks and announce errors with `role="alert"`.
- Package-owned UI must continue using the integration SDK boundary, not import from `apps/frontend`. Until the SDK exposes a file picker, reproduce this treatment using the host-provided `Button` and a hidden input; preserve accessibility, cancellation, reselection, and disabled behavior.

## Code And Command Blocks

- Use bordered inset blocks, not black translucent overlays:
  `rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3 font-mono text-xs text-[var(--foreground)]`
- Use `IntegrationCopyableCode` for copyable commands, URLs, IDs, secrets, and endpoint values. Its copy control is icon-only: an absolute `h-7 w-7` button at `right-2 top-2`, with a Lucide `Copy` icon at `h-3.5 w-3.5`, changing briefly to a green `Check` icon after success.
- Give every icon-only copy button an action-specific `aria-label` and matching `title`, such as `Copy webhook endpoint`. Do not place visible `Copy` or `Copied` text inside the field.

## Setup-Specific Guidance

- Treat setup as a product workflow, not a launch splash page.
- Use the same forms, cards, muted copy, and status badges as the Design System page.
- Match all integration connection-dialog instruction and setup-guide callouts to GCP and GitHub. Use an outer `rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-left` surface with an `items-start gap-3` row. Place `BookOpen` at `h-4 w-4 text-muted` inside a `h-8 w-8 shrink-0 rounded-lg` inset container using the standard border and background tokens. Render the title as `text-sm font-medium`, the description as `mt-1 text-xs leading-relaxed text-muted`, and the guide anchor as `mt-3 inline-flex items-center gap-1.5 text-xs font-medium` with the standard underline and hover treatment. End the label with `ExternalLink` at `h-3.5 w-3.5`, and set `target="_blank"` plus `rel="noopener noreferrer"`.
- If a setup screen currently uses a bespoke hero, gradient, or white-on-dark panel, replace it with normal surface cards unless there is a strong repo-local reason not to.

## Anti-Patterns

- Do not invent page-local button classes when a shared `Button` variant already fits.
- Do not implement copyable value fields with visible `Copy`/`Copied` button text or a page-local copy-button style; use the shared icon-only pattern.
- Do not hard-code slate/white/dark palette values for product pages when theme tokens already exist.
- Do not mix marketing-style hero sections with system-style forms in the same flow.
- Do not use large custom radii or heavy shadows by default when the system uses `rounded-xl` and `shadow-sm`.
