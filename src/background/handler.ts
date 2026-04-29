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
  updateProduct,
  vatCheck,
} from '@/background/api/endpoints'
import { runBootstrap, getCounts } from '@/background/sync/bootstrap'
import { runIncremental, isIncrementalRunning } from '@/background/sync/incremental'
import { search, searchLocal, searchRemoteOnly, addOrUpdate as indexProduct } from '@/background/search'
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
import {
  defaultAlertConfig as mhDefaultAlertConfig,
  defaultCountryCode as mhDefaultCountryCode,
  defaultVerifyPrices as mhDefaultVerifyPrices,
  excludeRetailer as mhExcludeRetailer,
  getExclusions as mhGetExclusions,
  getHistory as mhGetHistory,
  getTracking as mhGetTracking,
  includeRetailer as mhIncludeRetailer,
  listTracked as mhListTracked,
  lookup as mhLookup,
  refreshTracking as mhRefreshTracking,
  stopTracking as mhStopTracking,
  testConnection as mhTestConnection,
  track as mhTrack,
  updateTracking as mhUpdateTracking,
  verifyTracking as mhVerifyTracking,
} from '@/background/api/materials-hub'
import {
  clearTrackingId,
  getTrackingId,
  pruneMappingByTrackingId,
  setTrackingId,
} from '@/background/storage/price-tracking'
import { runAgentTurn, testConnection as testAgentConnection } from '@/background/agent'
import { translateToGreek } from '@/background/translation'
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
    case 'catalog/list-all': {
      return { ok: true, products: await Products.all() } as MessageResponse
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

    // --- Materials Hub Price Monitoring -----
    case 'prices/status-for-product': {
      const trackingId = await getTrackingId(message.product_key)
      if (trackingId) {
        try {
          const record = await mhGetTracking(trackingId)
          return { ok: true, tracked: true, record } as unknown as MessageResponse
        } catch (err) {
          // 404 → drop the stale mapping so we fall through to recovery.
          const status = (err as { status?: number })?.status
          if (status !== 404) {
            return { ok: false, error: String((err as Error)?.message ?? err) }
          }
          await clearTrackingId(message.product_key)
        }
      }
      // Local miss — try to recover by asking the API for everything tracked
      // under this key and matching by search_query. Heals old-format
      // mappings, cleared storage, new devices. Silent no-op if the caller
      // didn't hand us a query to match against.
      const q = (message.search_query ?? '').trim()
      if (!q) {
        return { ok: true, tracked: false } as unknown as MessageResponse
      }
      try {
        const list = await mhListTracked()
        const match = findTrackingByQuery(list, q)
        if (match?.tracking_id) {
          await setTrackingId(message.product_key, match.tracking_id)
          const record = await mhGetTracking(match.tracking_id)
          return {
            ok: true,
            tracked: true,
            record,
            recovered: true,
          } as unknown as MessageResponse
        }
        return { ok: true, tracked: false } as unknown as MessageResponse
      } catch (err) {
        // Recovery failure shouldn't block the UI — just treat as not-tracked
        // so the user still sees the "start tracking" CTA instead of an error.
        console.warn('[oxygen-helper] tracking recovery failed', err)
        return { ok: true, tracked: false } as unknown as MessageResponse
      }
    }
    case 'prices/start-tracking': {
      try {
        const verify = await mhDefaultVerifyPrices()
        const alertDefaults = await mhDefaultAlertConfig()
        const record = await mhTrack({
          search_query: message.search_query,
          dimensions: message.dimensions,
          // Caller can override; otherwise we use the user's saved default.
          country_code: message.country_code ?? (await mhDefaultCountryCode()),
          refresh_interval_hours: message.refresh_interval_hours,
          ...(verify !== undefined ? { verify_prices: verify } : {}),
          ...alertDefaults,
        })
        if (record.tracking_id) {
          await setTrackingId(message.product_key, record.tracking_id)
        }
        return { ok: true, tracked: true, record } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/refresh-for-product': {
      try {
        const trackingId = await getTrackingId(message.product_key)
        if (!trackingId) {
          return { ok: false, error: 'Δεν έχει οριστεί παρακολούθηση για αυτό το προϊόν.' }
        }
        // v6: refreshes are caller-controlled. The server may respond with
        // `status: "throttled"` + a `throttle_until` timestamp when we hit
        // /refresh again before `refresh_interval_hours` has elapsed.
        // Surface that as a friendly error to the UI rather than a generic
        // failure; nothing was charged, no work happened.
        // Align the tracked row's verification flag with the user's current
        // setting BEFORE refreshing. Rows created before v3 (2026-04-25) keep
        // `verify_prices: undefined` on the server and never run Firecrawl
        // on subsequent refreshes — flipping it on via PUT once fixes that
        // for good. We only issue the PUT when we can see the existing row
        // is out of sync with what the user wants, so we don't waste a call
        // every time.
        try {
          const existing = await mhGetTracking(trackingId)
          const verifyPref = await mhDefaultVerifyPrices()
          // verifyPref is `false` when the user opted out, undefined otherwise
          // (= wants the server default, which is `true`). Compare against
          // the row's current state and PUT only on mismatch.
          const want = verifyPref === false ? false : true
          if (existing.verify_prices !== want) {
            await mhUpdateTracking(trackingId, { verify_prices: want })
          }
        } catch (syncErr) {
          console.warn('[oxygen-helper] verify_prices sync skipped', syncErr)
        }
        const record = await mhRefreshTracking(trackingId)
        const recAny = record as unknown as { status?: string; throttle_until?: string }
        if (recAny.status === 'throttled') {
          const until = recAny.throttle_until
            ? new Date(recAny.throttle_until).toLocaleString('el-GR')
            : null
          return {
            ok: false,
            error: until
              ? `Πολύ συχνή ανανέωση. Επόμενη επιτρεπτή: ${until}.`
              : 'Πολύ συχνή ανανέωση — δοκίμασε ξανά αργότερα.',
          }
        }
        return { ok: true, tracked: true, record } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/exclusions/get': {
      const trackingId = await getTrackingId(message.product_key)
      if (!trackingId) return { ok: true, hostnames: [] } as unknown as MessageResponse
      try {
        const raw = await mhGetExclusions(trackingId)
        return { ok: true, hostnames: extractExclusionHostnames(raw) } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/exclusions/add': {
      const trackingId = await getTrackingId(message.product_key)
      if (!trackingId) return { ok: false, error: 'Δεν έχει οριστεί παρακολούθηση.' }
      try {
        await mhExcludeRetailer(trackingId, {
          domain: message.hostname,
          reason: 'hidden via Oxygen Helper UI',
        })
        return { ok: true } as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/exclusions/remove': {
      const trackingId = await getTrackingId(message.product_key)
      if (!trackingId) return { ok: false, error: 'Δεν έχει οριστεί παρακολούθηση.' }
      try {
        await mhIncludeRetailer(trackingId, { domain: message.hostname })
        return { ok: true } as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/exclusions/clear': {
      const trackingId = await getTrackingId(message.product_key)
      if (!trackingId) return { ok: true } as MessageResponse
      try {
        const raw = await mhGetExclusions(trackingId)
        for (const h of extractExclusionHostnames(raw)) {
          await mhIncludeRetailer(trackingId, { domain: h }).catch((e) =>
            console.warn('[oxygen-helper] include failed during clear', e),
          )
        }
        return { ok: true } as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'translate/to-greek': {
      try {
        const out = await translateToGreek(message.text)
        return { ok: true, text: out } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/verify-for-product': {
      try {
        const trackingId = await getTrackingId(message.product_key)
        if (!trackingId) {
          return { ok: false, error: 'Δεν έχει οριστεί παρακολούθηση για αυτό το προϊόν.' }
        }
        const payload = message.urls && message.urls.length ? { urls: message.urls } : {}
        try {
          const verifyRes = await mhVerifyTracking(trackingId, payload)
          // Re-fetch the full tracking record so the UI receives the same
          // shape it would after /refresh — verified flags refreshed in place.
          const record = await mhGetTracking(trackingId)
          return {
            ok: true,
            tracked: true,
            record,
            verify: verifyRes,
          } as unknown as MessageResponse
        } catch (verifyErr) {
          // The /verify endpoint is v6 and may not be deployed yet for
          // every workspace. A 404 from the verify call (vs. a 404 from
          // getTracking which means the tracking row itself is gone) is
          // most likely "endpoint not available here" — surface a precise
          // message so the user knows to fall back to plain Ανανέωση.
          const status = (verifyErr as { status?: number })?.status
          if (status === 404) {
            // Distinguish "endpoint missing" from "tracking row gone" by
            // checking the tracking row still exists.
            try {
              await mhGetTracking(trackingId)
              return {
                ok: false,
                error:
                  'Η επαναξακρίβωση δεν είναι διαθέσιμη ακόμη σε αυτόν τον λογαριασμό. Χρησιμοποίησε «Ανανέωση» για ολοκληρωμένη ενημέρωση τιμής.',
              }
            } catch {
              return {
                ok: false,
                error:
                  'Η παρακολούθηση δεν υπάρχει πλέον στον server. Ξεκίνα νέα παρακολούθηση από το προϊόν.',
              }
            }
          }
          return {
            ok: false,
            error: String((verifyErr as Error)?.message ?? verifyErr),
          }
        }
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/test-connection': {
      try {
        const r = await mhTestConnection()
        return { ok: true, message: r.message } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/history-for-product': {
      try {
        const trackingId = await getTrackingId(message.product_key)
        if (!trackingId) {
          return { ok: true, history: [] } as unknown as MessageResponse
        }
        const res = await mhGetHistory(trackingId)
        return { ok: true, history: res } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/list-tracked': {
      try {
        const raw = await mhListTracked()
        return { ok: true, tracked: raw } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/refresh-by-id': {
      try {
        const record = await mhRefreshTracking(message.tracking_id)
        return { ok: true, record } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/stop-by-id': {
      try {
        try {
          await mhStopTracking(message.tracking_id)
        } catch (err) {
          console.warn('[oxygen-helper] stopTracking by id remote call failed', err)
        }
        // Prune any local mapping pointing at this tracking_id so the
        // per-product Κέρδος UI reverts cleanly on the next modal open.
        await pruneMappingByTrackingId(message.tracking_id)
        return { ok: true } as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/update-by-id': {
      try {
        const record = await mhUpdateTracking(message.tracking_id, message.patch)
        return { ok: true, record } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/lookup-quick': {
      try {
        const verify = await mhDefaultVerifyPrices()
        const record = await mhLookup({
          search_query: message.search_query,
          dimensions: message.dimensions,
          country_code: message.country_code ?? (await mhDefaultCountryCode()),
          ...(verify !== undefined ? { verify_prices: verify } : {}),
        })
        return { ok: true, record } as unknown as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
    case 'prices/stop-for-product': {
      try {
        const trackingId = await getTrackingId(message.product_key)
        if (trackingId) {
          try {
            await mhStopTracking(trackingId)
          } catch (err) {
            // Even if the delete fails remotely (e.g. already gone), drop
            // the local mapping so the UI recovers.
            console.warn('[oxygen-helper] stopTracking remote call failed', err)
          }
          await clearTrackingId(message.product_key)
        }
        return { ok: true } as MessageResponse
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }

    // --- Bulk deactivate (stale products cleanup) -----
    case 'products/bulk-deactivate': {
      const results: Array<{ id: string; ok: boolean; error?: string }> = []
      for (const id of message.ids) {
        try {
          const updated = await updateProduct(id, { status: false })
          await Products.put(updated)
          await indexProduct(updated)
          results.push({ id, ok: true })
        } catch (err) {
          results.push({ id, ok: false, error: String((err as Error)?.message ?? err) })
        }
      }
      return { ok: true, results } as unknown as MessageResponse
    }

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

/**
 * Find a tracking row in the API's list that matches a given search query.
 * We normalize both sides (NFD + strip combining marks + lowercase + collapse
 * whitespace) and compare exactly first, then fall back to "contains" either
 * direction. That tolerates small differences like dimensions being appended
 * client-side in newer sessions but not older ones.
 */
function findTrackingByQuery(
  raw: unknown,
  query: string,
): { tracking_id?: string } | null {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? (() => {
          const r = raw as Record<string, unknown>
          for (const key of ['items', 'data', 'results', 'tracked', 'tracking']) {
            if (Array.isArray(r[key])) return r[key] as unknown[]
          }
          return []
        })()
      : []
  if (!list.length) return null
  const needle = normalizeQueryText(query)
  if (!needle) return null

  // Exact-match pass first.
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (!r.tracking_id && !r.id) continue
    const q = normalizeQueryText(String(r.search_query ?? r.query ?? ''))
    if (q && q === needle) {
      return { tracking_id: String(r.tracking_id ?? r.id) }
    }
  }
  // Containment pass — handles "name only" vs "name + dimensions" drift.
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (!r.tracking_id && !r.id) continue
    const q = normalizeQueryText(String(r.search_query ?? r.query ?? ''))
    if (q && (q.includes(needle) || needle.includes(q))) {
      return { tracking_id: String(r.tracking_id ?? r.id) }
    }
  }
  return null
}

function normalizeQueryText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Flatten the API's exclusions response into the simple hostname array the
 * UI consumes. Per docs, the response is `{ exclusions: [...] }` and each
 * row is either `{ domain: "x.gr" }` or `{ url: "https://x.gr/..." }`.
 */
function extractExclusionHostnames(raw: unknown): string[] {
  const list = (raw && typeof raw === 'object'
    ? (raw as { exclusions?: unknown[] }).exclusions
    : Array.isArray(raw) ? raw : null) ?? []
  const hosts = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as { domain?: string; url?: string }
    let host = r.domain ?? ''
    if (!host && r.url) {
      try { host = new URL(r.url).hostname } catch { /* */ }
    }
    if (!host) continue
    hosts.add(host.toLowerCase().replace(/^www\./, ''))
  }
  return Array.from(hosts)
}
