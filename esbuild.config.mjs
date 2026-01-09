import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { transformHookPlugin } from 'esbuild-plugin-transform-hook';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Plugin to patch setMaxListeners for AbortSignal in bundled code
const patchSetMaxListenersPlugin = transformHookPlugin({
  hooks: [
    {
      on: 'end',
      pattern: /main\.js$/,  // Match the output bundle file
      transform: (source) => {
        // Replace the setMaxListeners call with Symbol-based workaround
        const originalPattern = /\(0, import_events\.setMaxListeners\)\((\w+), (\w+)\.signal\)/g;
        const replacement = `(() => {
          const key = Object.getOwnPropertySymbols(new AbortController().signal).find(
            (key) => key.description === "events.maxEventTargetListeners"
          );
          if (key) $2.signal[key] = $1;
        })()`;

        const patched = source.replace(originalPattern, replacement);
        if (patched !== source) {
          console.log('[esbuild] Patched setMaxListeners call for AbortSignal');
        }
        return patched;
      }
    }
  ]
});

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  platform: 'node',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  outfile: 'dist/main.js',
  // Workaround for import.meta.url in bundled code
  define: {
    'import.meta.url': '_importMetaUrl',
  },
  banner: {
    js: "const _importMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
  // Preserve class/function names for instanceof checks
  keepNames: true,
  // Disable minification to preserve class inheritance
  minify: false,
  minifyIdentifiers: false,
  minifySyntax: false,
  minifyWhitespace: false,
  // Add plugin to patch setMaxListeners for AbortSignal
  plugins: [patchSetMaxListenersPlugin],
});

if (watch) {
  await context.watch();
  console.log('Watching for changes...');
} else {
  await context.rebuild();
  await context.dispose();
  console.log('Build complete');
}
