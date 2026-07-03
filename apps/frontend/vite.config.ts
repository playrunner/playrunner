import fs from 'fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const repoRoot = path.resolve(__dirname, '../..');
  const playwrightRunnerConfig = loadPlaywrightRunnerConfig();
  const apiProxyTarget = normalizeLocalProxyTarget(
    env.VITE_API_URL ||
      process.env.VITE_API_URL ||
      getApiUrlFromApiEnv(repoRoot),
  );
  const editionRuntimePath = resolveEditionRuntimePath(
    env.ENABLE_PREMIUM !== 'false',
    env.PREMIUM_WEB_RUNTIME_PATH,
  );
  const webNodeModulesDir = path.resolve(__dirname, 'node_modules');
  console.log(`Proxying API requests to: ${apiProxyTarget}`);

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __PLAYWRIGHT_RUNNER_CONFIG__: JSON.stringify(playwrightRunnerConfig),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@edition-runtime': editionRuntimePath,
        '@playrunner/integration-sdk': path.resolve(
          repoRoot,
          'packages/integration-sdk/src/frontend/index.tsx',
        ),
        '@playrunner/integration-registry': path.resolve(
          repoRoot,
          'packages/integration-registry/src/frontend/index.ts',
        ),
        '@playrunner/environment': path.resolve(
          repoRoot,
          'packages/environment/src/frontend/index.tsx',
        ),
        '@playrunner/gcp': path.resolve(
          repoRoot,
          'packages/gcp/src/frontend/index.tsx',
        ),
        '@playrunner/github': path.resolve(
          repoRoot,
          'packages/github/src/frontend/index.tsx',
        ),
        '@playrunner/jira': path.resolve(
          repoRoot,
          'packages/jira/src/frontend/index.tsx',
        ),
        '@playrunner/javascript': path.resolve(
          repoRoot,
          'packages/javascript/src/frontend/index.tsx',
        ),
        '@playrunner/playwright': path.resolve(
          repoRoot,
          'packages/playwright/src/frontend/index.tsx',
        ),
        '@playrunner/schedule': path.resolve(
          repoRoot,
          'packages/schedule/src/frontend/index.tsx',
        ),
        react: path.resolve(webNodeModulesDir, 'react'),
        'react/jsx-runtime': path.resolve(
          webNodeModulesDir,
          'react/jsx-runtime.js',
        ),
        'react-dom': path.resolve(webNodeModulesDir, 'react-dom'),
        'lucide-react': path.resolve(webNodeModulesDir, 'lucide-react'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      port: 3000,
      strictPort: true,
      host: true,
      fs: {
        allow: [repoRoot],
      },
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        '/outputs': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});

function normalizeLocalProxyTarget(target: string): string {
  try {
    const url = new URL(target);

    // Prefer IPv4 loopback for the local API to avoid intermittent DNS lookup
    // failures on `localhost` in the Vite proxy process.
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
    }

    return url.toString();
  } catch {
    return target;
  }
}

function parseEnvValue(rawValue = '') {
  const trimmed = rawValue.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function getEnvVariable(envPath: string, key: string) {
  if (!fs.existsSync(envPath)) {
    return '';
  }

  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));

  return line ? parseEnvValue(line.slice(key.length + 1)) : '';
}

function getApiUrlFromApiEnv(repoRoot: string) {
  const apiEnvPath = path.resolve(repoRoot, 'apps/api/.env');
  const apiPort = getEnvVariable(apiEnvPath, 'PORT');

  if (!apiPort) {
    throw new Error(
      `VITE_API_URL is not set and ${apiEnvPath} does not define PORT.`,
    );
  }

  if (!/^\d+$/.test(apiPort)) {
    throw new Error(`Invalid PORT in ${apiEnvPath}: ${apiPort}`);
  }

  return `http://127.0.0.1:${apiPort}`;
}

function loadPlaywrightRunnerConfig() {
  const configPath = path.resolve(
    __dirname,
    '..',
    '..',
    'config',
    'playwright-runner-versions.json',
  );
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function resolveEditionRuntimePath(
  enablePremium: boolean,
  configuredPath?: string,
) {
  if (enablePremium) {
    const candidates = [
      configuredPath,
      path.resolve(__dirname, '../../premium/frontend/src/runtime/edition.ts'),
      path.resolve(
        __dirname,
        '../../../premium/frontend/src/runtime/edition.ts',
      ),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const premiumEditionPath = path.resolve(candidate);
      if (fs.existsSync(premiumEditionPath)) {
        return premiumEditionPath;
      }
    }
  }

  return path.resolve(__dirname, './src/runtime/edition.ts');
}
