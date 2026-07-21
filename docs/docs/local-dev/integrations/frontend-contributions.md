---
sidebar_position: 3
title: Frontend Contributions
description: Contribute package-owned integration metadata, settings, and workflow node configuration UI.
---

# Frontend Contributions

A frontend contribution describes how an integration appears and behaves in
the Playrunner web application. It does not execute the integration's workflow
action.

## Declare and export the surface

Declare the frontend entrypoint in the package manifest and expose the same
subpath through `exports`:

```json
{
  "playrunner": {
    "integration": {
      "id": "example",
      "frontend": "."
    }
  },
  "exports": {
    ".": {
      "types": "./src/frontend/index.tsx",
      "import": "./src/frontend/index.tsx",
      "require": "./src/frontend/index.tsx",
      "default": "./src/frontend/index.tsx"
    }
  }
}
```

The entrypoint must default-export an object satisfying the `Integration`
contract from `@playrunner/integration-sdk`:

```tsx
import type { Integration } from '@playrunner/integration-sdk';
import { ExampleConfigPanel } from './ExampleConfigPanel';
import { ExampleSettingsModal } from './ExampleSettingsModal';
import { exampleIconUrl } from './icon';

export const exampleIntegration: Integration = {
  id: 'example',
  name: 'Example',
  category: 'Developer Tools',
  description: 'Run an Example action',
  icon: exampleIconUrl,
  nodeType: 'action',
  SettingsModal: ExampleSettingsModal,
  ConfigPanel: ExampleConfigPanel,
};

export default exampleIntegration;
```

The exported `id` must equal `playrunner.integration.id`. The contract also
supports visibility and availability flags, authentication metadata, ordering,
package-owned icons, refresh behavior, and optional settings and config
components.

Keep brand assets in the package and resolve them from package source, as the
existing packages do with `new URL('../../assets/example.svg', import.meta.url)`.

### Choose the icon pattern by brand behavior

Use the provider's visual behavior to choose between the two supported icon
patterns:

- Fixed-color and multicolor logos, such as Jira, Slack, and Playwright, use a
  package-owned SVG URL as the integration `icon`. Render these logos as normal
  images so their brand colors remain unchanged.
- Monochrome logos that must follow the active theme, such as GitHub and OpenAI,
  use a package-owned React SVG component with `fill="currentColor"`. Set that
  component as the integration `icon` and reuse it in settings and connection
  UI.

For a theme-adaptive icon, keep the raw asset URL as a separate export when
consumers need it. Do not pass the URL as the integration icon and do not apply
the SVG through CSS `mask-image`; both approaches can render the SVG as an
opaque rectangle instead of the intended mark.

```tsx
export function ExampleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="..." />
    </svg>
  );
}
```

Then register and reuse the component:

```tsx
import { ExampleIcon } from './ExampleIcon';

export const exampleIntegration: Integration = {
  id: 'example',
  name: 'Example',
  category: 'Developer Tools',
  description: 'Run an Example action',
  icon: ExampleIcon,
  nodeType: 'action',
  SettingsModal: ExampleSettingsModal,
  ConfigPanel: ExampleConfigPanel,
};

<IntegrationSettingsModal
  icon={<ExampleIcon className="h-5 w-5 text-[var(--foreground)]" />}
  {...settingsModalProps}
/>;
```

## Use the SDK host boundary

Package UI accesses Playrunner-owned services through
`@playrunner/integration-sdk`. `IntegrationSdkProvider` supplies the host, and
package components call `useIntegrationHost()` to access authentication,
integration persistence, cloud credentials, environments, secrets, and shared
UI primitives.

Do not import application internals from `apps/frontend/src`. Keeping the SDK
as the boundary lets the package own its UI without taking a dependency on the
host app's private modules.

For connection forms, use the SDK's connection input and autofill guard helpers
so credential fields follow the shared browser-autofill behavior. Keep
provider-specific setup, settings, and node configuration components in the
provider package.

## How the host composes the frontend

Before frontend development, typechecking, or building, the frontend's package
script runs the shared composition generator. It scans the frontend app's
installed direct production dependencies and writes static imports to:

```text
apps/frontend/src/integrations/generated-package-contributions.ts
```

`apps/frontend/src/integrations/registry.ts` validates that every default
export is an object and that its ID matches the package manifest. It then adds
those contributions to the product registry. Duplicate IDs are rejected.

Local `file:` dependencies resolve through the frontend app's installed
`node_modules`; Vite preserves symlinks for those package imports. There is no
provider-specific Vite or TypeScript alias to add.

Adding a frontend package or changing its metadata still requires updating the
frontend artifact's selected dependency and rebuilding the frontend. Connecting
credentials or editing a workflow node after deployment only configures the
already-bundled contribution.
