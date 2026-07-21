---
name: playrunner-design-system
description: Align frontend UI changes in the Playrunner repo to the existing Design System and shared primitives. Use when editing styling, layout, forms, cards, buttons, badges, onboarding/setup screens, or other React pages in `apps/web` or `apps/setup`, especially when the request mentions polish, consistency, or following the Design System page.
---

# Playrunner Design System

## Overview

Follow the existing Playrunner UI system instead of inventing a page-specific visual language. Start from the Design System page, shared UI primitives, and theme tokens, then pull the target screen toward those patterns.

## Workflow

1. Inspect `apps/frontend/src/pages/DesignSystem.tsx` before making visual changes.
2. Reuse shared primitives from `apps/frontend/src/components/ui` before adding ad hoc Tailwind classes.
3. Keep page-level layout on theme tokens from `apps/frontend/src/index.css`; do not introduce a one-off palette for product pages.
4. Prefer system surfaces, typography, spacing, and code-block treatments from the reference file below.
5. Remove bespoke hero treatments, custom gradients, and isolated button styles when the page is supposed to behave like normal product UI.
6. Validate the affected frontend surface after editing.

## Rules

- Use `Button`, `Input`, `Select`, `Textarea`, and `Badge` from `apps/frontend/src/components/ui` when those controls fit the need.
- In integration connection/settings dialogs, use `IntegrationConnectionInput` from `@playrunner/integration-sdk` instead of raw `Input` for manual fields, and include `IntegrationConnectionAutofillGuard` in custom modals so browsers and password-manager extensions do not autofill connection credentials.
- Render every connection-dialog instructions or setup-guide callout with the canonical GCP/GitHub pattern: a `BookOpen` icon in the left inset icon container, title and supporting copy on the right, and an underlined guide link ending with an `ExternalLink` icon. Preserve the canonical sizing, spacing, theme-token classes, new-tab behavior, and `noopener noreferrer` relationship documented in `references/design-system.md`.
- Render fixed-color or multicolor integration logos from their package-owned SVG URL. For monochrome logos that change with the theme, follow GitHub's package-owned React SVG component pattern with `fill="currentColor"`, and reuse the same component everywhere the integration icon appears; do not use a CSS mask.
- Use `bg-background`, `bg-surface`, `bg-surface-hover`, `text-[var(--foreground)]`, `text-muted`, `border-[var(--border)]`, and `border-subtle` instead of hard-coded colors.
- Use `rounded-xl` and `shadow-sm` for standard product cards and inset panels.
- Use `max-w-7xl mx-auto` on the top-level standard document page container, with page padding on that same container, so the primary content width stays consistent across Projects, Environments, Integrations, Insights, Teams, Settings, and Design System.
- Use `text-3xl font-semibold tracking-tight` for page titles, `text-xl font-medium` for section headings, `text-sm text-muted leading-relaxed` for supporting copy, and `font-mono text-xs` for commands or env vars.
- Use bordered section headers and stacked surface cards like the Design System page.
- Prefer nested inset panels with `bg-[var(--background)]` inside a `bg-[var(--surface)]` page card.
- Treat setup/onboarding screens as normal product surfaces, not marketing splash pages.
- Standard document-style pages must use the browser's native document scroll. Do not put page content in `overflow-y-auto`, `overflow-auto`, `h-screen overflow-hidden`, or similar inner vertical scroll containers unless building a fixed tool surface such as the editor canvas, a modal body, a dropdown menu, or a log panel.
- Pay attention to the lint and Prettier rules when writing code; run the affected app's `lint` and `format:check` scripts and keep changes passing both.

## Reference

Read `references/design-system.md` for the distilled rules, source files, and anti-patterns before making substantial UI styling changes.
