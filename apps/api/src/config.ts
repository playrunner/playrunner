import type { Request } from 'express';

export const ORCHESTRATOR_PORT = parseInt(
  process.env.ORCHESTRATOR_PORT || '3012',
  10,
);
export const LOCAL_ORCHESTRATOR_IMAGE =
  process.env.LOCAL_ORCHESTRATOR_IMAGE || 'playrunner-orchestrator';
export const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL || `http://localhost:${ORCHESTRATOR_PORT}`;
export const EDITOR_API_URL_DOCKER =
  process.env.EDITOR_API_URL_DOCKER ||
  `http://host.docker.internal:${process.env.PORT || '3011'}`;
export const LOCAL_PUBSUB_PROJECT_ID =
  process.env.LOCAL_PUBSUB_PROJECT_ID || 'playrunner-local';
export const PUBSUB_EMULATOR_HOST_DOCKER =
  process.env.PUBSUB_EMULATOR_HOST_DOCKER ||
  `host.docker.internal:${process.env.PUBSUB_EMULATOR_PORT || 8084}`;
const schedulerPublicApiUrl = process.env.PLAYRUNNER_PUBLIC_API_URL || '';
export const PORT = process.env.PORT || '3011';

export function getPublicApiBaseUrl(req: Request): string {
  const configured = schedulerPublicApiUrl.trim().replace(/\/+$/g, '');
  if (configured) {
    return configured;
  }

  return `${req.protocol}://${req.get('host')}`;
}
