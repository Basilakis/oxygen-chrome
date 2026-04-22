import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        // Explicitly tell Rollup the popup HTML is an entry so Vite rewrites its
        // <script src="./popup.ts"> into the compiled JS bundle. When the popup is
        // only referenced via web_accessible_resources (no default_popup), the
        // crxjs plugin copies the file as-is and the script reference never
        // resolves, breaking tab/settings/close handlers in the detached window.
        popup: fileURLToPath(new URL('./src/popup/index.html', import.meta.url)),
      },
    },
  },
})
