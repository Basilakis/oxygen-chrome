/**
 * Minimal `document` shim for the service worker.
 *
 * Vite's modulepreload polyfill (`__vitePreload` in the bundle) calls
 * `document.getElementsByTagName`, `document.querySelector`, and
 * `document.createElement` on every dynamic `import()` whose module has any
 * dependencies. Service workers have no `document`, so those calls throw
 * `ReferenceError: document is not defined` the first time a dynamic import
 * fires — blocking any handler that uses `await import(...)` (or that depends
 * on a module whose side-effect graph Vite decided to split).
 *
 * This module installs a minimal no-op stub on `globalThis`/`self` before any
 * other module loads. The polyfill's bookkeeping still runs, it just has
 * nothing to do. The real `import()` continues to work via native ESM.
 *
 * Imported as the FIRST import in `src/background/index.ts` so the stub
 * lands before `@/background/handler` (and its transitive chunks) evaluate.
 */

const target =
  typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : undefined

if (target && typeof target.document === 'undefined') {
  const fakeElement = {
    setAttribute: () => void 0,
    appendChild: () => void 0,
    addEventListener: () => void 0,
    removeEventListener: () => void 0,
    remove: () => void 0,
    relList: { supports: () => false },
  }
  target.document = {
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeElement,
    head: {
      appendChild: () => void 0,
    },
  }
}

export {}
