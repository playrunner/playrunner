/// <reference types="vite/client" />

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
