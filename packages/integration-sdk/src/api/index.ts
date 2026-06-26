export interface IntegrationApiContribution<TRouter = unknown> {
  id: string;
  mountPath: string;
  router: TRouter;
}

export function createApiContribution<TRouter>(
  contribution: IntegrationApiContribution<TRouter>,
) {
  return contribution;
}
