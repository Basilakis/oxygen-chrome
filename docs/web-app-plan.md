# Web app + PWA plan (Vercel)

Ship the Oxygen Helper as a Progressive Web App hosted on Vercel, in parallel with the existing Chrome extension. Both share a `core/` TypeScript package; only the shells differ.

This supersedes the earlier Capacitor mobile-app plan because:

- Zero cost (free Vercel hobby + $0 app stores vs $99/yr + $25)
- Works on **any** device with a browser (desktop, iPad, Android, iPhone) — installable to home screen via PWA
- Instant updates (git push → live in seconds, no TestFlight/Play review)
- ~3–4 days to ship vs 1.5–2 weeks for Capacitor

## CORS pre-check — done ✓

Probed before committing to the design. Both APIs are browser-CORS-friendly:

```
https://api.oxygen.gr              ← Access-Control-Allow-Origin echoes dynamically,
                                     Vary: Origin, Allow-Headers: authorization
https://api.anthropic.com          ← Full CORS with authorization, x-api-key,
                                     anthropic-version headers allowed
```

Result: **no proxy is needed for CORS**. The web app can call both APIs directly from the browser.

## Architecture

```
  Browser (PWA at oxygen-helper.vercel.app)
  │
  ├── Direct fetch → api.oxygen.gr   (with user's Oxygen bearer token from localStorage)
  │
  └── Fetch via Vercel serverless → api.anthropic.com   (proxy only to hide the key)
      /api/anthropic/messages  — forwards body + ANTHROPIC_API_KEY from env var
```

Only **one** serverless function: the Anthropic proxy, existing solely to keep the Claude key out of the browser. Everything else is static.

```
repo/
├── src/
│   ├── core/                    shared package (no chrome.* calls)
│   │   ├── api, search, sku, drafts, sync, agent
│   │   └── storage/ (KVStore with chrome + web impls)
│   │
│   └── shells/
│       ├── extension/           current MV3 code
│       └── web/                 NEW Vite web app → builds to dist-web/
│           ├── index.html       single-page app, same tab structure as popup
│           ├── main.ts
│           ├── manifest.webmanifest    PWA metadata
│           └── sw.ts            service worker (offline cache)
│
├── api/                         Vercel serverless (Node runtime)
│   └── anthropic/messages.ts   ~30-line proxy to api.anthropic.com
│
├── vercel.json                  deployment config
└── .github/workflows/
    └── build-extension.yml      packages the Chrome extension on release
```

## Deployment — already automatic

**Vercel GitHub integration** (enabled once via the Vercel dashboard):

- Push to `main` → Vercel detects the commit → runs `npm run build:web` → deploys to production
- Push to a feature branch → gets a preview URL
- No manual build/deploy step needed

**Environment variables** (set once in Vercel dashboard):

- `ANTHROPIC_API_KEY` — used by `/api/anthropic/messages` serverless function. Never exposed to the browser.

**Chrome extension packaging** via GitHub Action:

- Trigger: push of a `v*` tag
- Action: runs `npm run build`, zips `dist/`, attaches to GitHub Release as `oxygen-helper-{version}.zip`
- User downloads the zip, loads unpacked (or for personal use, uses `chrome://extensions` → Load unpacked on the extracted folder)

## What ports as-is (web app + extension)

- Catalog search (Αναζήτηση) — IndexedDB + MiniSearch work identically in any browser
- Drafts editor (Πρόχειρα)
- Status / sync
- Options / settings
- AI agent (JARVIS) + session history — history persists via localStorage on web, chrome.storage on extension
- Full Oxygen API client (fetch-based)

## What gets cut in the web app

Same as the mobile cut-list. These are desktop-browser-only because they need MV3 content scripts:

| Feature | Status in web app |
|---|---|
| Flow 1: AADE invoice-modal scraper + button injection | ✗ not available |
| Right-click context menus (search-selection, pin-to-draft) | ✗ |
| 📍 Picker for product title from arbitrary pages | ✗ |
| Auto-detect product badge on webpages | ✗ |

Extension keeps all of these — that's why we ship both. The web app is your "access everywhere" companion; the extension is the power-tool when you're on the Oxygen website or browsing supplier sites on desktop.

## What gets added in the web app

| Feature | Effect |
|---|---|
| **PDF / photo invoice → create products + supplier** | Upload or photograph a supplier invoice → Claude Vision extracts supplier (name + ΑΦΜ) + line items → creates the supplier if missing (`POST /contacts`) + creates products (`POST /products`). Essentially Flow 1 without needing the AADE modal. Works on mobile, desktop, and as an additional mode in the extension. |
| Paste-from-clipboard shortcut in search | Copy a product name from anywhere, paste into search. Lower-friction substitute for the page picker. |
| iOS / Android "Add to Home Screen" | PWA manifest makes the site installable with an app icon, full-screen, offline-capable. |

## What is NOT possible today (API gap)

- **Recording expenses / supplier invoices as payable entries**: the Oxygen API has no `/expenses`, `/supplier-invoices`, `/purchases`, or equivalent endpoint (all return 404 as of April 2026). The PDF-to-products flow above creates the **products** side, but the actual expense/payable record has to be entered manually in the Oxygen UI afterward.

If Oxygen publishes an expense endpoint later, adding a "create expense from the same PDF" step is ~half a day — the extraction work is already done, just need the POST target and the payload mapping.

## Build hygiene — strict separation of shell outputs

The extension build and the web-app build **must not overlap**. Each shell ships only the files it needs.

### What goes where

| Directory / file | Extension build | Web build | Vercel deploy |
|---|---|---|---|
| `src/core/**` | ✓ | ✓ | ✓ (bundled into web) |
| `src/shared/**` | ✓ | ✓ | ✓ (bundled) |
| `src/shells/extension/background/**` | ✓ | ✗ | ✗ |
| `src/shells/extension/content/**` (content scripts, scraper, picker, overlays) | ✓ | ✗ | ✗ |
| `src/shells/extension/popup/**` | ✓ | ✗ | ✗ |
| `src/shells/extension/options/**` | ✓ | ✗ | ✗ |
| `manifest.json` | ✓ | ✗ | ✗ |
| `src/shells/web/**` (index.html, main.ts, PWA sw, manifest.webmanifest) | ✗ | ✓ | ✓ |
| `api/**` (Vercel serverless Anthropic proxy) | ✗ | ✗ (not bundled by Vite) | ✓ (deployed as functions) |
| `vercel.json` | ✗ | ✗ | ✓ |
| `docs/**`, `tests/**`, `README.md` | ✗ | ✗ | ✗ |

### Build scripts

```json
{
  "scripts": {
    "build:ext": "vite build --config vite.config.ext.ts",
    "build:web": "vite build --config vite.config.web.ts",
    "build": "npm run build:ext && npm run build:web",
    "typecheck": "tsc --noEmit"
  }
}
```

Two separate `vite.config.*.ts` files, each with its own entry points and `rollupOptions.input`. The extension config is the current `vite.config.ts` with `@crxjs/vite-plugin` and `manifest.json`. The web config uses `shells/web/index.html` as the single HTML entry and emits to `dist-web/`.

### Output isolation

- Extension: `dist/` (uncommitted, used by `chrome://extensions` → Load unpacked OR zipped for release)
- Web app: `dist-web/` (uncommitted, Vercel deploys this)
- **Neither output contains files from the other shell.** Enforced by explicit `rollupOptions.input` in each config — only the imports reachable from those entries get bundled.

### Vercel deploy configuration (`vercel.json`)

```json
{
  "buildCommand": "npm run build:web",
  "outputDirectory": "dist-web",
  "framework": null
}
```

Combined with a `.vercelignore`:

```
dist/
src/shells/extension/
manifest.json
tests/
docs/
```

That way Vercel's build machine never touches extension source files, never runs the extension's Vite config, and the deployed artifact contains zero extension code. Storage + bandwidth savings are minor; the real benefit is clean mental separation.

### GitHub Action for extension packaging (`.github/workflows/build-extension.yml`)

```yaml
name: Package extension
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build:ext            # builds ONLY the extension, no web output
      - name: Zip the extension
        run: |
          cd dist
          zip -r ../oxygen-helper-${{ github.ref_name }}.zip .
      - uses: softprops/action-gh-release@v2
        with: { files: oxygen-helper-*.zip }
```

The zipped artifact is only `dist/` — no `dist-web/`, no `api/`, no source.

### `.gitignore` updates

```
dist/
dist-web/
.vercel/
```

## Phased rollout (~5–6 days)

### Phase 1 — extract `src/core/` (1–2 days)

Pull the framework-agnostic code out of `src/background/` + `src/shared/` into `src/core/`. Define a `KVStore` interface with two impls:

- `kv.chrome.ts` — wraps `chrome.storage.local`
- `kv.web.ts` — wraps `localStorage`

Migrate the extension's settings, agent sessions, and auth-check storage to the interface. Extension keeps working; no user-visible change.

### Phase 2 — Vite web build (1 day)

Add a `shells/web/` entry. Configure Vite for a second build target:

- `npm run build` → extension (`dist/`)
- `npm run build:web` → web app (`dist-web/`)

Port the popup HTML + tabs to full-screen layout. Reuse all existing CSS. Add PWA manifest + minimal service worker for offline cache.

### Phase 3 — Anthropic proxy + Vercel config (½ day)

Write `api/anthropic/messages.ts`:

```ts
export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const body = await req.text()
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body,
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  })
}
```

Update the core agent client: in web mode, fetch `/api/anthropic/messages` without the key (the server adds it); in extension mode, use the existing direct-fetch with user-BYOK key.

Add `vercel.json` + push. Set `ANTHROPIC_API_KEY` in Vercel dashboard.

### Phase 4 — PDF / photo invoice flow (1–2 days)

The web-app equivalent of Flow 1. Since mobile can't scrape the AADE modal, this is the primary way to create products from an invoice there — and it's useful in the extension too for PDF invoices that never appear in the AADE pending list.

New UI: "Από τιμολόγιο" screen with:

- Camera button (`<input type="file" accept="image/*,application/pdf" capture="environment">`) for mobile photo + file picker for desktop
- Upload slot accepts PDF, JPEG, PNG
- On submit:
  1. File sent to Claude Messages API with a vision prompt:
     _"Extract from this invoice: supplier (name + ΑΦΜ), issue date, line items (each with description, quantity, unit price, VAT %). Return as JSON matching this schema: …"_
  2. Claude returns structured JSON via tool output
  3. UI shows the extracted data in the **same prefill form** as Flow 1 (reuses `src/shells/extension/content/overlays/prefill-modal.ts` → which moves into `src/core/ui/prefill-form.ts` during Phase 1)
  4. User edits / confirms
  5. Supplier resolved via existing `resolveSupplier` (local cache → `/vat-check` → create)
  6. Products created via existing `createProductsSequential`

Reuse is near-total. The only new code is the file-picker UI, the Claude Vision call, and the JSON → prefill-form mapping.

**Note on expense recording**: as documented above, Oxygen's API has no expense endpoint yet. This flow creates the **products** + **supplier** but NOT an expense/payable record. That step remains manual in Oxygen's UI. When an endpoint surfaces, we add one more button here.

### Phase 5 — release automation (½ day)

`.github/workflows/build-extension.yml`:

- Trigger on `v*` tag push
- Steps: checkout → setup Node → `npm ci` → `npm run build` → zip `dist/` → upload to GitHub Release

Optional: separate workflow for the web build, though Vercel handles that automatically. This one is only needed so users can download a .zip of the extension.

## Cost

- **$0 recurring**. Vercel hobby tier covers this comfortably (100GB bandwidth, unlimited deploys).
- Only ongoing cost is Anthropic API usage (paid per-token, billed directly to you at Anthropic).

## Tradeoffs

- **PWA on iOS is less reliable for background work.** No real background sync; sync runs on app-open. Usually fine for a catalog tool used on-demand.
- **No desktop-browsing integrations.** "Pin from a supplier's website" is extension-only. Mobile/tablet users use camera-to-invoice or manual entry instead.
- **Claude API usage is tracked on your Anthropic bill.** If the web app is shared with others (multi-user), consider rate-limiting via the proxy — trivial to add later.
- **Token handling**: Oxygen token lives only in the user's browser localStorage. Anthropic key lives only on the Vercel server. Neither is shared.

## Suggested order

Phase 1 (`src/core/` extraction) has value even if the web app never ships — cleaner separation of Chrome-specific vs universal code in the extension. Doesn't commit us to anything further.

When ready to ship the web app: Phases 2 + 3 are quick (1.5 days), and Vercel auto-deploy means there's no manual ops work after the initial setup.
