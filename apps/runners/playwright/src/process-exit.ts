export function describePlaywrightProcessExit(args: {
  code: number | null;
  sharded: boolean;
  signal: NodeJS.Signals | null;
}) {
  if (args.code !== null) {
    return `Tests failed with code ${args.code}`;
  }

  const signal = args.signal ? ` after signal ${args.signal}` : '';
  const guidance = args.sharded
    ? 'Auto sharding is already enabled; increase the maximum CPU or memory per shard and retry.'
    : 'Consider enabling Suite sharding Auto, reducing workers, or increasing the node CPU and memory limits.';

  return `The Playwright process ended without an exit code${signal}. It likely crashed or was terminated by the operating system, often because it exceeded available CPU or memory. ${guidance}`;
}
