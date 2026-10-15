import { build } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { resolve, dirname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputPath = resolve(
  process.env.WORKFLOW_EDITOR_OUTPUT ||
    resolve(root, '../mcp/dist/workflow-editor.html'),
);
// The resource has no API client; Vite still requires a proxy target while loading its config.
process.env.VITE_API_URL ||= 'http://127.0.0.1:3011';
// Build the same node catalog, package-owned icons, geometry and theme as the
// editor. The resource is entirely self-contained inside the MCP Apps sandbox.
const result = await build({
  root,
  configFile: resolve(
    process.env.WORKFLOW_EDITOR_VITE_CONFIG || resolve(root, 'vite.config.ts'),
  ),
  mode: 'production',
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    write: false,
    cssCodeSplit: false,
    sourcemap: false,
    lib: {
      entry: resolve(root, 'src/mcp-workflow/entry.tsx'),
      name: 'PlayrunnerWorkflowCanvas',
      formats: ['es'],
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(
  (result) => result.output,
);
let script = outputs
  .filter((o) => o.type === 'chunk')
  .map((o) => o.code)
  .join('\n');
// Registry stubs can reference public icons rather than imported package assets.
// Inline those as well, so every icon works without allowing external resources.
for (const match of [
  ...script.matchAll(/["'](\/images\/[a-zA-Z0-9_./-]+\.svg)["']/g),
]) {
  const path = match[1];
  const asset = await readFile(resolve(root, 'public', path.slice(1)));
  script = script.replaceAll(
    path,
    `data:image/svg+xml;base64,${asset.toString('base64')}`,
  );
}
const css = outputs
  .filter((o) => o.type === 'asset' && o.fileName.endsWith('.css'))
  .map((o) => String(o.source))
  .join('\n')
  .replace(/@import\s+url\([^;]+;/g, '');
if (!script || !css)
  throw new Error(
    'The workflow canvas build did not produce JavaScript and CSS.',
  );
const template = await readFile(
  resolve(root, '../mcp/src/workflow-editor.html'),
  'utf8',
);
const html = template
  .replace('<!-- WORKFLOW_CANVAS_STYLES -->', () => `<style>${css}</style>`)
  .replace(
    '<!-- WORKFLOW_CANVAS_SCRIPT -->',
    () =>
      `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`,
  );
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, html);
console.log(
  `Workflow editor resource: ${outputPath} (${Math.round(Buffer.byteLength(html) / 1024)} KiB)`,
);
