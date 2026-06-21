import {createRequire} from 'module';
import path from 'path';
import {defineConfig, loadEnv} from '../web/node_modules/vite/dist/node/index.js';

const webRequire = createRequire(path.resolve(__dirname, '../web/package.json'));

export default defineConfig(async ({mode}) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../web'), '');
  const [{default: react}, {default: tailwindcss}] = await Promise.all([
    import(webRequire.resolve('@vitejs/plugin-react')),
    import(webRequire.resolve('@tailwindcss/vite')),
  ]);
  const defaultSetupInstallerUrl = 'http://127.0.0.1:3003';
  const webNodeModulesDir = path.resolve(__dirname, '../web/node_modules');
  const setupProxyTarget = normalizeLocalProxyTarget(
    env.VITE_SETUP_INSTALLER_URL || defaultSetupInstallerUrl,
  );

  console.log(`Proxying setup installer requests to: ${setupProxyTarget}`);

  return {
    root: __dirname,
    plugins: [react(), tailwindcss()],
    publicDir: path.resolve(__dirname, '../web/public'),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@web': path.resolve(__dirname, '../web/src'),
        react: path.resolve(webNodeModulesDir, 'react'),
        'react/jsx-runtime': path.resolve(webNodeModulesDir, 'react/jsx-runtime.js'),
        'react/jsx-dev-runtime': path.resolve(webNodeModulesDir, 'react/jsx-dev-runtime.js'),
        'react-dom': path.resolve(webNodeModulesDir, 'react-dom'),
        'react-dom/client': path.resolve(webNodeModulesDir, 'react-dom/client.js'),
        'react-router-dom': path.resolve(webNodeModulesDir, 'react-router-dom'),
        'lucide-react': path.resolve(webNodeModulesDir, 'lucide-react'),
        clsx: path.resolve(webNodeModulesDir, 'clsx'),
        'tailwind-merge': path.resolve(webNodeModulesDir, 'tailwind-merge'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      port: 3000,
      host: true,
      proxy: {
        '/setup-api': {
          target: setupProxyTarget,
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/setup-api/, ''),
        },
      },
    },
  };
});

function normalizeLocalProxyTarget(target: string): string {
  try {
    const url = new URL(target);

    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
    }

    return url.toString();
  } catch {
    return target;
  }
}
