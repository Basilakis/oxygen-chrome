/**
 * Pure message handler — dispatches every typed Message to its implementation.
 * No `chrome.*` side effects at module load. This lets both shells consume it:
 *   - Extension SW  → wires it to chrome.runtime.onMessage
 *   - Web app       → calls it directly via the local-dispatcher hook in
 *                     `@/core/messaging/dispatcher`
 *
 * A single setter hook (`setSyncIntervalHook`) exists so the extension shell
 * can re-arm chrome.alarms when the user changes the sync interval. The web
 * shell doesn't register this hook (no chrome.alarms).
 */

import type { Message, MessageResponse, SyncStatus, AuthStatus } from '@/shared/messages'
import { getSettings, updateSettings, setAuthCheck, getAuthCheck } from '@/background/storage/settings'
import { getRuntimeConfig } from '@/core/config'
import { apiRequest, resetAuthInvalid } from '@/background/api/client'
import {
  createContact,
  findContactByVat,
  vatCheck,
} from '@/background/api/endpoints'
import { runBootstrap, getCounts } from '@/background/sync/bootstrap'
import { runIncremental, isIncrementalRunning } from '@/background/sync/incremental'
import { search, searchLocal, searchRemoteOnly } from '@/background/search'
import { suggest as suggestSku, previewNext as previewSku } from '@/background/sku/generator'
import {
  BusinessAreas,
  Categories,
  Contacts,
  Logos,
  MeasurementUnits,
  NumberingSequences,
  PaymentMethods,
  Products,
  Sync,
  Taxes,
  Variations,
  Warehouses,
} from '@/background/storage/stores'
import { wipeDatabase } from '@/background/storage/db'
import {
  addLine,
  convertSubmittedDraftToInvoice,
  createDraft,
  deleteDraft,
  getActiveDraft,
  getDraft,
  listDrafts,
  matchLineToProduct,
  removeLine,
  setActiveDraft,
  submitDraftAsNotice,
  updateDraft,
  updateLine,
} from '@/background/drafts/manager'
import { createProductsSequential, findVariationFamily, resolveSupplier, updateProductsSequential } from '@/background/handlers/flow1'
import { runAgentTurn, testConnection as testAgentConnection } from '@/background/agent'
import {
  listSessions as agentListSessions,
  getSession as agentGetSession,
  saveSession as agentSaveSession,
  deleteSession as agentDeleteSession,
  clearAllSessions as agentClearSessions,
  type AgentSession,
} from '@/background/agent/sessions'
import { assertNever } from '@/shared/util'

let syncIntervalHook: (() => Promise<void>) | null = null
export function setSyncIntervalHook(fn: () => Promise<void>): void {
  syncIntervalHook = fn
}

export async function buildAuthStatus(): Promise<AuthStatus> {
  const settings = await getSettings()
  const check = await getAuthCheck()
  return {
    has_token: !!settings.token,
    mode: settings.mode,
    base_url: settings.base_url,
    last_connect_check: check,
  }
}

export async function buildSyncStatus(): Promise<SyncStatus> {
  const counts = await getCounts()
  const bootstrap = await Sync.get('__bootstrap__')
  const incremental = await Sync.get('__incremental__')
  const all = await Sync.all()
  const lastError = all
    .filter((m) => m.last_error)
    .sort((a, b) => b.last_run_at - a.last_run_at)[0]?.last_error
  return {
    running: false,
    last_bootstrap_at: bootstrap?.last_success_at,
    last_incremental_at: incremental?.last_success_at,
    counts: counts as SyncStatus['counts'],
    last_error: lastError,
  }
}

export async function handle(message: Message): Promise<MessageResponse> {
  switch (message.type) {
    case 'ping':
      return { ok: true, pong: Date.now() } as MessageResponse

    // --- Auth -----
    case 'auth/get-status':
      return { ok: true, auth: await buildAuthStatus() } as MessageResponse
    case 'auth/set-token': {
      await updateSettings({ token: message.token })
      resetAuthInvalid()
      return { ok: true, auth: await buildAuthStatus() } as MessageResponse
    }
    case 'auth/clear-token': {
      await updateSettings({ token: undefined })
      await setAuthCheck({ ok: false, at: Date.now(), message: 'cleared' })
      return { ok: true, auth: await buildAuthStatus() } as MessageResponse
    }
    case 'auth/test-connection': {
      try {
        const settings = await getSettings()
        if (!settings.token) {
          throw new Error('Δεν έχει αποθηκευτεί token. Επικόλλησε το bearer token και πάτησε αποθήκευση.')
        }
        if (!settings.base_url) {
          throw new Error('Δεν έχει οριστεί base URL.')
        }
        console.debug('[oxygen-helper] test-connection → GET', settings.base_url + '/taxes')
        await apiRequest('/taxes', { query: { per_page: 1 }, retry: false })
        await setAuthCheck({ ok: true, at: Date.now() })
        resetAuthInvalid()
        return { ok: true, auth: await buildAuthStatus() } as MessageResponse
      } catch (err) {
        let message = String((err as Error)?.message ?? err)
        const body = (err as { body?: unknown })?.body
        if (body && typeof body === 'object') {
          try {
            message += ` · ${JSON.stringify(body).slice(0, 200)}`
          } catch {
            /* ignore */
          }
        }
        console.error('[oxygen-helper] test-connection failed', err)
        await setAuthCheck({ ok: false, at: Date.now(), message })
        return { ok: false, error: message }
      }
    }

    // --- Settings -----
    case 'settings/get':
      return { ok: true, settings: await getSettings() } as MessageResponse
    case 'settings/update': {
      const next = await updateSettings(message.patch)
      if (message.patch.sync_interval_minutes !== undefined && syncIntervalHook) {
        await syncIntervalHook()
      }
      return { ok: true, settings: next } as MessageResponse
    }

    // --- Sync -----
    case 'sync/bootstrap':
      await runBootstrap()
      return { ok: true, status: await buildSyncStatus() } as MessageResponse
    case 'sync/incremental':
      await runIncremental()
      return { ok: true, status: await buildSyncStatus() } as MessageResponse
    case 'sync/auto': {
      // Throttled auto-sync for popup/web-shell page loads. Skips if:
      //   - A sync is already running (don't stack them).
      //   - The last successful incremental ran less than AUTO_SYNC_MIN_AGE
      //     ms ago (prevents a spam of syncs when the user opens/closes the
      //     popup repeatedly).
      //   - No Oxygen token is configured (either extension BYOK missing, or
      //     web multi-user mode without a pasted token and no server-side
      //     OXYGEN_API_TOKEN).
      const AUTO_SYNC_MIN_AGE_MS = 2 * 60 * 1000
      const state = await buildSyncStatus()
      if (isIncrementalRunning()) {
        return { ok: true, skipped: true, reason: 'running', status: state } as unknown as MessageResponse
      }
      const age =
        state.last_incremental_at !== undefined
          ? Date.now() - state.last_incremental_at
          : Infinity
      if (age < AUTO_SYNC_MIN_AGE_MS) {
        return { ok: true, skipped: true, reason: 'fresh', age_ms: age, status: state } as unknown as MessageResponse
      }
      const settings = await getSettings()
      const runtime = getRuntimeConfig()
      const haveAuth = Boolean(settings.token) || runtime.serverAuth
      if (!haveAuth) {
        return { ok: true, skipped: true, reason: 'no_token', status: state } as unknown as MessageResponse
      }
      try {
        await runIncremental()
        return { ok: true, skipped: false, ran: true, status: await buildSyncStatus() } as unknown as MessageResponse
      } catch (err) {
        return {
          ok: true,
          skipped: false,
          ran: false,
          error: String((err as Error)?.message ?? err),
          status: await buildSyncStatus(),
        } as unknown as MessageResponse
      }
    }
    case 'sync/status':
      return { ok: true, status: await buildSyncStatus() } as MessageResponse

    // --- Search -----
    case 'search/catalog': {
      const results = await search(message.query, message.limit ?? 20)
      return { ok: true, results } as MessageResponse
    }
    case 'search/catalog/local': {
      const results = await searchLocal(message.query, message.limit ?? 20)
      return { ok: true, results } as MessageResponse
    }
    case 'search/catalog/remote': {
      const results = await searchRemoteOnly(message.query, message.limit ?? 20)
      return { ok: true, results } as MessageResponse
    }
    case 'catalog/get-product': {
      const p = await Products.get(message.id)
      if (!p) return { ok: false, error: `product ${message.id} not in cache` }
      return { ok: true, product: p } as MessageResponse
    }

    // --- Lookups (cached) -----
    case 'lookups/get-taxes':
      return { ok: true, taxes: await Taxes.all() } as MessageResponse
    case 'lookups/get-warehouses':
      return { ok: true, warehouses: await Warehouses.all() } as MessageResponse
    case 'lookups/get-categories':
      return { ok: true, categories: await Categories.all() } as MessageResponse
    case 'lookups/get-measurement-units':
      return { ok: true, measurement_units: await MeasurementUnits.all() } as MessageResponse
    case 'lookups/get-payment-methods':
      return { ok: true, payment_methods: await PaymentMethods.all() } as MessageResponse
    case 'lookups/get-numbering-sequences':
      return { ok: true, numbering_sequences: await NumberingSequences.all() } as MessageResponse
    case 'lookups/get-logos':
      return { ok: true, logos: await Logos.all() } as MessageResponse
    case 'lookups/get-business-areas':
      return { ok: true, business_areas: await BusinessAreas.all() } as MessageResponse
    case 'lookups/get-variations':
      return { ok: true, variations: await Variations.all() } as MessageResponse

    // --- Contacts -----
    case 'contacts/find-by-vat': {
      const cached = await Contacts.findByVat(message.vat)
      if (cached) return { ok: true, contact: cached } as MessageResponse
      const remote = await findContactByVat(message.vat)
      if (!remote) return { ok: false, error: 'not found' }
      await Contacts.put(remote)
      return { ok: true, contact: remote } as MessageResponse
    }
    case 'contacts/vat-check': {
      const vat = await vatCheck(message.vat)
      return { ok: true, vat } as MessageResponse
    }
    case 'contacts/create': {
      const created = await createContact(message.contact)
      await Contacts.put(created)
      return { ok: true, contact: created } as MessageResponse
    }
    case 'contacts/search': {
      const all = await Contacts.all()
      const q = message.query.trim().toLowerCase()
      const limit = message.limit ?? 25
      if (!q) return { ok: true, contacts: all.slice(0, limit) } as MessageResponse
      const norm = (s: string | undefined): string =>
        (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const needle = norm(q)
      const matches = all.filter((c) => {
        return (
          norm(c.name).includes(needle) ||
          norm(c.surname).includes(needle) ||
          norm(c.company_name).includes(needle) ||
          norm(c.nickname).includes(needle) ||
          norm(c.vat_number).includes(needle) ||
          norm(c.email).includes(needle)
        )
      })
      return { ok: true, contacts: matches.slice(0, limit) } as MessageResponse
    }
    case 'contacts/get': {
      const c = await Contacts.get(message.id)
      if (!c) return { ok: false, error: `contact ${message.id} not in cache` }
      return { ok: true, contact: c } as MessageResponse
    }

    // --- Flow 1 -----
    case 'flow1/resolve-supplier': {
      const r = await resolveSupplier(message.vat, message.autoCreate ?? true)
      return { ok: true, contact: r.contact } as MessageResponse
    }
    case 'flow1/suggest-sku': {
      const sku = await suggestSku({
        description: message.description,
        categoryName: message.categoryName,
        offset: message.offset,
      })
      return { ok: true, sku } as MessageResponse
    }
    case 'sku/preview': {
      const preview = await previewSku({ categoryName: message.categoryName })
      return { ok: true, preview } as unknown as MessageResponse
    }
    case 'flow1/create-products': {
      const results = await createProductsSequential(message.supplier_id, message.products)
      return { ok: true, results } as unknown as MessageResponse
    }
    case 'flow1/update-products': {
      const results = await updateProductsSequential(message.updates)
      return { ok: true, results } as unknown as MessageResponse
    }
    case 'flow1/find-variation-family': {
      const family = await findVariationFamily(message.description)
      return { ok: true, family } as unknown as MessageResponse
    }
    case 'flow1/scrape-detected':
      return { ok: true } as MessageResponse

    // --- Drafts -----
    case 'drafts/list':
      return { ok: true, drafts: await listDrafts() } as MessageResponse
    case 'drafts/get':
      return { ok: true, draft: await getDraft(message.id) } as MessageResponse
    case 'drafts/get-active':
      return { ok: true, draft: await getActiveDraft() } as MessageResponse
    case 'drafts/create':
      return { ok: true, draft: await createDraft(message.header) } as MessageResponse
    case 'drafts/set-active':
      await setActiveDraft(message.id)
      return { ok: true } as MessageResponse
    case 'drafts/update':
      return { ok: true, draft: await updateDraft(message.id, message.patch) } as MessageResponse
    case 'drafts/delete':
      await deleteDraft(message.id)
      return { ok: true } as MessageResponse
    case 'drafts/add-line':
      return { ok: true, draft: await addLine(message.draft_id, message.line) } as MessageResponse
    case 'drafts/update-line':
      return { ok: true, draft: await updateLine(message.draft_id, message.line_id, message.patch) } as MessageResponse
    case 'drafts/remove-line':
      return { ok: true, draft: await removeLine(message.draft_id, message.line_id) } as MessageResponse
    case 'drafts/match-line':
      return { ok: true, draft: await matchLineToProduct(message.draft_id, message.line_id, message.product_id) } as MessageResponse
    case 'drafts/submit': {
      const r = await submitDraftAsNotice(message.draft_id)
      return { ok: true, draft: r.draft, notice_id: r.notice_id } as unknown as MessageResponse
    }
    case 'drafts/convert-to-invoice': {
      const r = await convertSubmittedDraftToInvoice(message.draft_id)
      return { ok: true, draft: r.draft, invoice_id: r.invoice_id } as unknown as MessageResponse
    }

    // --- Agent -----
    case 'agent/ask': {
      try {
        const result = await runAgentTurn(
          message.text,
          (message.history ?? []) as never,
          message.attachments ?? [],
        )
        return { ok: true, agent: result } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'agent/test-connection': {
      const res = await testAgentConnection()
      if (res.ok) return { ok: true, message: res.message } as unknown as MessageResponse
      return { ok: false, error: res.message }
    }
    case 'agent/sessions/list': {
      const sessions = await agentListSessions()
      return { ok: true, sessions } as unknown as MessageResponse
    }
    case 'agent/sessions/get': {
      const s = await agentGetSession(message.id)
      return { ok: true, session: s } as unknown as MessageResponse
    }
    case 'agent/sessions/save': {
      await agentSaveSession(message.session as AgentSession)
      return { ok: true } as MessageResponse
    }
    case 'agent/sessions/delete': {
      await agentDeleteSession(message.id)
      return { ok: true } as MessageResponse
    }
    case 'agent/sessions/clear': {
      await agentClearSessions()
      return { ok: true } as MessageResponse
    }

    // --- Diagnostics -----
    case 'diagnostics/reset': {
      const { sessionKv } = await import('@/core/storage/kv')
      await wipeDatabase()
      await sessionKv().clear()
      return { ok: true } as MessageResponse
    }
    case 'diagnostics/snapshot': {
      return {
        ok: true,
        settings: await getSettings(),
        sync: await Sync.all(),
        counts: await getCounts(),
      } as unknown as MessageResponse
    }

    // --- No-op (content script / popup-side messages) -----
    case 'contextmenu/search-selection':
    case 'contextmenu/pin-selection':
    case 'picker/activate':
    case 'picker/picked':
      return { ok: true } as MessageResponse

    default:
      return assertNever(message, 'unknown message')
  }
}
