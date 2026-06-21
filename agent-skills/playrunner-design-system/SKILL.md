---
name: playrunner-design-system
description: Align frontend UI changes in the Playrunner repo to the existing Design System and shared primitives. Use when editing styling, layout, forms, cards, buttons, badges, onboarding/setup screens, or other React pages in `apps/web` or `apps/setup`, especially when the request mentions polish, consistency, or following the Design System page.
---

# Playrunner Design System

## Overview

Follow the existing Playrunner UI system instead of inventing a page-specific visual language. Start from the Design System page, shared UI primitives, and theme tokens, then pull the target screen toward those patterns.

## Workflow

1. Inspect `apps/web/src/pages/DesignSystem.tsx` before making visual changes.
2. Reuse shared primitives from `apps/web/src/components/ui` before adding ad hoc Tailwind classes.
3. Keep page-level layout on theme tokens from `apps/web/src/index.css`; do not introduce a one-off palette for product pages.
4. Prefer system surfaces, typography, spacing, and code-block treatments from the reference file below.
5. Remove bespoke hero treatments, custom gradients, and isolated button styles when the page is supposed to behave like normal product UI.
6. Validate the affected frontend surface after editing.

## Rules

- Use `Button`, `Input`, `Select`, `Textarea`, and `Badge` from `apps/web/src/components/ui` when those controls fit the need.
- Use `bg-background`, `bg-surface`, `bg-surface-hover`, `text-[var(--foreground)]`, `text-muted`, `border-[var(--border)]`, and `border-subtle` instead of hard-coded colors.
- Use `rounded-xl` and `shadow-sm` for standard product cards and inset panels.
- Use `text-3xl font-semibold tracking-tight` for page titles, `text-xl font-medium` for section headings, `text-sm text-muted leading-relaxed` for supporting copy, and `font-mono text-xs` for commands or env vars.
- Use bordered section headers and stacked surface cards like the Design System page.
- Prefer nested inset panels with `bg-[var(--background)]` inside a `bg-[var(--surface)]` page card.
- Treat setup/onboarding screens as normal product surfaces, not marketing splash pages.
- Pay attention to the lint and Prettier rules when writing code; run the affected app's `lint` and `format:check` scripts and keep changes passing both.

## Reference

Read `references/design-system.md` for the distilled rules, source files, and anti-patterns before making substantial UI styling changes.
