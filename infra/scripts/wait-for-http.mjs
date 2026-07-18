const [url, rawTimeoutSeconds = '60'] = process.argv.slice(2);

if (!url) {
  console.error('Usage: node wait-for-http.mjs <url> [timeout-seconds]');
  process.exit(1);
}

const timeoutSeconds = Number(rawTimeoutSeconds);
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
  console.error(`Invalid timeout: ${rawTimeoutSeconds}`);
  process.exit(1);
}

const deadline = Date.now() + timeoutSeconds * 1000;
let lastError = 'service is unavailable';

console.log(`Waiting for ${url}...`);

while (Date.now() < deadline) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      console.log(`Ready: ${url}`);
      process.exit(0);
    }

    lastError = `HTTP ${response.status}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
}

console.error(`Timed out waiting for ${url}: ${lastError}`);
process.exit(1);
