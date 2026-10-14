export async function fetchArtifactWithRetry(
  url: URL,
  init: RequestInit,
  fetcher = fetch,
  wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(120_000),
        redirect: 'error',
      });
      if (
        response.ok ||
        attempt === 3 ||
        ![408, 429, 500, 502, 503, 504].includes(response.status)
      )
        return response;
      await response.body?.cancel();
    } catch (error) {
      if (attempt === 3) throw error;
    }
    await wait(1_000 * 2 ** attempt);
  }
}
