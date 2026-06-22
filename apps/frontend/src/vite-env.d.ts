/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DOCS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type PlaywrightRunnerVersion = {
  tag: string;
  label: string;
  publishAsLatest?: boolean;
};

type PlaywrightRunnerConfig = {
  defaultTag: string;
  versions: PlaywrightRunnerVersion[];
};

declare const __PLAYWRIGHT_RUNNER_CONFIG__: PlaywrightRunnerConfig;
