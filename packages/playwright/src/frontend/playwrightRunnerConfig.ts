export type PlaywrightRunnerVersion = {
  tag: string;
  label: string;
  publishAsLatest?: boolean;
};

export type PlaywrightRunnerConfig = {
  defaultTag: string;
  versions: PlaywrightRunnerVersion[];
};

declare const __PLAYWRIGHT_RUNNER_CONFIG__: PlaywrightRunnerConfig;

export const playwrightRunnerConfig: PlaywrightRunnerConfig =
  __PLAYWRIGHT_RUNNER_CONFIG__;
