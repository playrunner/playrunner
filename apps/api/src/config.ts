export const ORCHESTRATOR_PORT = parseInt(
  process.env.ORCHESTRATOR_PORT || '3002',
  10,
);
export const ORCHESTRATOR_IMAGE =
  process.env.ORCHESTRATOR_IMAGE || 'playrunner-orchestrator';
export const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL || `http://localhost:${ORCHESTRATOR_PORT}`;
export const EDITOR_API_URL_DOCKER =
  process.env.EDITOR_API_URL_DOCKER ||
  `http://host.docker.internal:${process.env.PORT || 3001}`;
export const EDITOR_API_PUBLIC_URL = process.env.EDITOR_API_PUBLIC_URL || '';
export const PORT = process.env.PORT || 3001;
