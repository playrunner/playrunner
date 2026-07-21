import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface GcpE2EData {
  clientId: string;
  clientSecret: string;
}

export function createGcpE2EData({
  runId,
}: PlayrunnerE2EDataContext): GcpE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9]/g, '-');
  return {
    clientId: `gcp-client-${suffix}`,
    clientSecret: `gcp-secret-${suffix}`,
  };
}
