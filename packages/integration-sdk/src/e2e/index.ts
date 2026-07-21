import type { Page } from '@playwright/test';

export type PlayrunnerE2EMode = 'live' | 'mock';

export interface PlayrunnerE2EDataContext {
  mode: PlayrunnerE2EMode;
  runId: string;
  testId: string;
  workerIndex: number;
}

export interface PlayrunnerE2EHost {
  gotoIntegrations(): Promise<void>;
  openIntegration(input: { id: string; name: string }): Promise<void>;
}

export interface PlayrunnerE2EPomContext {
  host: PlayrunnerE2EHost;
  page: Page;
}

export interface PlayrunnerE2EScenarioContext<TPom, TData> {
  data: TData;
  expect: typeof import('@playwright/test').expect;
  host: PlayrunnerE2EHost;
  page: Page;
  pom: TPom;
}

export interface PlayrunnerE2EScenario<TPom, TData> {
  id: string;
  mode: PlayrunnerE2EMode;
  title: string;
  tags?: readonly string[];
  run(context: PlayrunnerE2EScenarioContext<TPom, TData>): Promise<void>;
}

export interface PlayrunnerE2EContribution<TPom = unknown, TData = unknown> {
  id: string;
  createData(context: PlayrunnerE2EDataContext): TData;
  createPom(context: PlayrunnerE2EPomContext): TPom;
  scenarios: readonly PlayrunnerE2EScenario<TPom, TData>[];
}

export function definePlayrunnerE2EContribution<TPom, TData>(
  contribution: PlayrunnerE2EContribution<TPom, TData>,
) {
  return contribution;
}
