import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import type {
  AgentExecutionBackend,
  AgentExecutionRequest,
  AgentExecutionResult,
  PreparedAgentRunner,
} from './contracts';

const AGENT_IMAGE = process.env.AGENT_IMAGE || 'playrunner-agent-runner:latest';
const RESULT_PREFIX = 'PLAYRUNNER_AGENT_RESULT:';

function containerName(request: AgentExecutionRequest) {
  const executionId = request.reqBody.testId || crypto.randomUUID();
  return `playrunner-agent-${executionId}-${request.nodeId}`
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .slice(0, 120);
}

async function stopContainer(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const process = spawn('docker', ['stop', '--time', '5', name], {
      stdio: 'ignore',
    });
    process.on('error', () => resolve(false));
    process.on('exit', (code) => resolve(code === 0));
  });
}

export class LocalAgentExecutionBackend implements AgentExecutionBackend {
  supports(cloudProvider: string): boolean {
    return cloudProvider === 'LOCAL_RUNNER';
  }

  async prepare(request: AgentExecutionRequest): Promise<PreparedAgentRunner> {
    const name = containerName(request);
    let child: ChildProcess | null = null;
    let started = false;
    let result: AgentExecutionResult | null = null;
    let resolveCompletion: (value: AgentExecutionResult) => void;
    let rejectCompletion: (error: Error) => void;
    const completion = new Promise<AgentExecutionResult>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    return {
      waitUntilReady: async () => {
        await request.publishLog(
          `AI Container image ready: ${AGENT_IMAGE}`,
          'build',
        );
      },
      start: async () => {
        if (started) return;
        started = true;
        const payload = {
          agent: request.agent,
          config: request.config,
          github: request.reqBody.settings?.github,
          validators: request.validators,
        };
        const args = [
          'run',
          '--rm',
          '--name',
          name,
          '--label',
          `playrunner.execution-id=${request.reqBody.testId || ''}`,
          '--label',
          `playrunner.node-id=${request.nodeId}`,
          '--cpus',
          String(request.config.cpu || 4),
          '--memory',
          `${request.config.memory || 8}g`,
          '--platform',
          'linux/amd64',
        ];
        for (const key of request.envKeys) {
          args.push('-e', `${key}=${request.globalEnvVars[key] || ''}`);
        }
        args.push('-e', `PAYLOAD=${JSON.stringify(payload)}`, AGENT_IMAGE);
        await request.publishLog(
          `Starting AI Container with ${request.agent.nodeType} and ${request.validators.length} validator${request.validators.length === 1 ? '' : 's'}.`,
          'build',
        );
        child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        request.registerActiveProcess(request.nodeId, child);
        let stdoutBuffer = '';
        const emitStdout = (chunk: Buffer) => {
          stdoutBuffer += chunk.toString();
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith(RESULT_PREFIX)) {
              try {
                const output = JSON.parse(
                  Buffer.from(
                    line.slice(RESULT_PREFIX.length),
                    'base64',
                  ).toString('utf8'),
                ) as Record<string, unknown>;
                result = {
                  outcome: output.status === 'passed' ? 'success' : 'error',
                  output,
                };
              } catch (error) {
                void request.publishLog(
                  `Could not parse AI Container result: ${String(error)}`,
                  'error',
                );
              }
            } else if (line.trim()) {
              void request.publishLog(`[AI Container] ${line.trim()}`, 'info');
            }
          }
        };
        child.stdout?.on('data', emitStdout);
        child.stderr?.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString().split(/\r?\n/)) {
            if (line.trim())
              void request.publishLog(`[AI Container] ${line.trim()}`, 'warn');
          }
        });
        child.on('error', (error) => rejectCompletion(error));
        child.on('exit', (code) => {
          if (result) resolveCompletion(result);
          else if (code === null)
            rejectCompletion(new Error('AI Container stopped by user.'));
          else
            rejectCompletion(
              new Error(
                `AI Container exited with code ${code} before returning a result.`,
              ),
            );
        });
      },
      waitForCompletion: async () => completion,
      cancel: async () => {
        if (child && !(await stopContainer(name))) child.kill('SIGTERM');
      },
      cleanup: async () => {
        if (child && child.exitCode == null) await stopContainer(name);
      },
    };
  }
}
