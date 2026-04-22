/**
 * Web-shell build config. Produces a static PWA bundle under dist-web/ that
 * Vercel serves. Does NOT run the @crxjs/vite-plugin — the extension manifest
 * and MV3-specific plumbing aren't used here.
 *
 * The entry points are:
 *   src/shells/web/index.html  (app)
 *   src/shells/web/sw.ts        (service worker, emitted to /sw.js at root)
 *
 * Extension shell + web shell share everything under src/ — only the entry
 * and the build config differ.
 */

import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Serve /src/shells/web/index.html at the site root during `vite dev`
  root: fileURLToPath(new URL('./src/shells/web', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist-web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(fileURLToPath(new URL('./src/shells/web/index.html', import.meta.url))),
        // Service worker must be emitted at /sw.js (root) so its scope is the
        // whole site. Using a separate input keeps it out of the main bundle.
        sw: resolve(fileURLToPath(new URL('./src/shells/web/sw.ts', import.meta.url))),
      },
      output: {
        // Keep sw.js at the root with its original name; hash everything else.
        entryFileNames: (chunk) =>
          chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
})
