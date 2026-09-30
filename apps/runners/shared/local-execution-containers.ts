import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const docker = async (args: string[]) =>
  (await exec("docker", args, { timeout: 15000, maxBuffer: 1024 * 1024 }))
    .stdout;

export async function executionContainers(id: string): Promise<string[]> {
  const output = await docker([
    "ps",
    "--filter",
    "label=playrunner.execution-id",
    "--format",
    '{{.ID}}\t{{.Label "playrunner.execution-id"}}',
  ]);
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [containerId, executionId] = line.split("\t");
      if (!/^[a-f0-9]{12,64}$/.test(containerId) || !executionId)
        throw new Error("Invalid Docker inventory.");
      return executionId === id ? [containerId] : [];
    });
}

export async function stopExecutionContainer(id: string) {
  // Docker escalates to SIGKILL after five seconds. Never target the shared
  // orchestrator; callers supply only IDs from this execution's inventory.
  await docker(["stop", "--time", "5", id]);
}
