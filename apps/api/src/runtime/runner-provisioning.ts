import { spawn } from 'child_process';
import { EDITOR_API_URL_DOCKER, GCP_PROJECT, ORCHESTRATOR_IMAGE, ORCHESTRATOR_PORT, PUBSUB_EMULATOR_HOST_DOCKER, PUBSUB_PROJECT_ID } from '../config';
import { state } from '../state';
import type { RunnerProvisionResult, RunnerProvisioner } from './contracts';

export class LocalDockerRunnerProvisioner implements RunnerProvisioner {
  async start(): Promise<RunnerProvisionResult> {
    if (state.runnerProcess) {
      return {
        body: { message: 'Runner is already running.' },
        status: 200,
      };
    }

    console.log('Starting orchestrator runner in a Docker container...');
    console.log(`Pubsub emulator host for Docker: ${PUBSUB_EMULATOR_HOST_DOCKER}`);

    state.runnerProcess = spawn('docker', [
      'run',
      '--rm',
      '-p', `${ORCHESTRATOR_PORT}:8080`,
      '-e', 'PORT=8080',
      '-e', `ENABLE_PREMIUM=${process.env.ENABLE_PREMIUM ?? 'true'}`,
      '-e', `PUBSUB_EMULATOR_HOST=${PUBSUB_EMULATOR_HOST_DOCKER}`,
      '-e', `PUBSUB_PROJECT_ID=${PUBSUB_PROJECT_ID}`,
      '-e', `GCP_PROJECT=${GCP_PROJECT}`,
      '-e', `EDITOR_API_URL=${EDITOR_API_URL_DOCKER}`,
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      ORCHESTRATOR_IMAGE
    ], {
      stdio: 'inherit'
    });

    state.runnerProcess.on('exit', (code) => {
      console.log(`Orchestrator Docker container exited with code ${code}`);
      state.runnerProcess = null;
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    return {
      body: { message: 'Docker Orchestrator started.' },
      status: 200,
    };
  }
}
