// Release policies pin the test repository independently of the application
// candidate. Discovery and shards must retain the same pinned test revision.
export function resolveReleaseSourceRevision(
  config: Record<string, unknown>,
  release: boolean,
  override?: string,
): string | undefined {
  if (!release) return override;
  const clonesRepository =
    config.action === 'clone' || (!config.action && config.repository);
  if (!clonesRepository) return override;

  const revision = config.branch;
  if (
    typeof revision !== 'string' ||
    !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(revision)
  )
    throw new Error(
      'Release test repositories require a full pinned Git commit SHA.',
    );
  const pinned = revision.toLowerCase();
  if (override !== undefined && override.toLowerCase() !== pinned)
    throw new Error(
      'Release test discovery does not match the pinned Git commit SHA.',
    );
  return pinned;
}
