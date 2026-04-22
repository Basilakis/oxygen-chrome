import {
  BusinessAreas,
  Categories,
  Contacts,
  Drafts,
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
import {
  getBusinessAreas,
  getContacts,
  getLogos,
  getMeasurementUnits,
  getNumberingSequences,
  getPaymentMethods,
  getProductCategories,
  getProducts,
  getTaxes,
  getVariations,
  getWarehouses,
} from '@/background/api/endpoints'
import { rebuildFromDB } from '@/background/search'
import { DEFAULT_VAT_RATE, STORES } from '@/shared/constants'
import { getSettings, updateSettings } from '@/background/storage/settings'

export interface SyncProgress {
  stage: string
  done: number
  total: number
  message?: string
}

export type ProgressCb = (p: SyncProgress) => void

let inFlight: Promise<void> | null = null

export function isRunning(): boolean {
  return inFlight !== null
}

export async function runBootstrap(onProgress?: ProgressCb): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const emit = (p: SyncProgress) => onProgress?.(p)
    const startedAt = Date.now()
    try {
      const steps: Array<{ name: string; run: () => Promise<void>; critical?: boolean }> = [
        { name: 'taxes', run: async () => await Taxes.replaceAll(await getTaxes()), critical: true },
        { name: 'warehouses', run: async () => await Warehouses.replaceAll(await getWarehouses()), critical: true },
        { name: 'product_categories', run: async () => await Categories.replaceAll(await getProductCategories()) },
        { name: 'measurement_units', run: async () => await MeasurementUnits.replaceAll(await getMeasurementUnits()) },
        { name: 'payment_methods', run: async () => await PaymentMethods.replaceAll(await getPaymentMethods()) },
        { name: 'numbering_sequences', run: async () => await NumberingSequences.replaceAll(await getNumberingSequences()) },
        { name: 'logos', run: async () => await Logos.replaceAll(await getLogos()) },
        { name: 'business_areas', run: async () => await BusinessAreas.replaceAll(await getBusinessAreas()) },
        { name: 'variations', run: async () => await Variations.replaceAll(await getVariations()) },
        { name: 'contacts', run: async () => await Contacts.replaceAll(await getContacts()), critical: true },
        { name: 'products', run: async () => await Products.replaceAll(await getProducts()), critical: true },
        { name: 'search_index', run: async () => await rebuildFromDB(), critical: true },
      ]
      let i = 0
      for (const step of steps) {
        emit({ stage: step.name, done: i, total: steps.length, message: `running ${step.name}` })
        try {
          await step.run()
          await Sync.put({
            resource: step.name,
            last_run_at: Date.now(),
            last_success_at: Date.now(),
          })
        } catch (err) {
          const msg = String((err as Error)?.message ?? err)
          await Sync.put({
            resource: step.name,
            last_run_at: Date.now(),
            last_error: msg,
          })
          if (step.critical) throw err
          console.warn(`[oxygen-helper] non-critical sync step "${step.name}" failed: ${msg}`)
        }
        i += 1
      }

      await inferDefaults()

      await Sync.put({
        resource: '__bootstrap__',
        last_run_at: startedAt,
        last_success_at: Date.now(),
      })
      emit({ stage: 'done', done: steps.length, total: steps.length })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

async function inferDefaults(): Promise<void> {
  const settings = await getSettings()
  const patch: Partial<typeof settings> = {}

  if (!settings.default_warehouse_id) {
    const ws = await Warehouses.all()
    if (ws.length) patch.default_warehouse_id = ws[0]!.id
  }
  if (!settings.default_category_id) {
    const cs = await Categories.all()
    if (cs.length) patch.default_category_id = cs[0]!.id
  }
  if (!settings.default_vat_id) {
    const ts = await Taxes.all()
    const apiDefault = ts.find((t) => t.is_default)
    const byRate = ts.find((t) => Math.round(t.rate) === DEFAULT_VAT_RATE)
    if (apiDefault) patch.default_vat_id = apiDefault.id
    else if (byRate) patch.default_vat_id = byRate.id
    else if (ts.length) patch.default_vat_id = ts[0]!.id
  }
  if (!settings.default_numbering_sequence_id) {
    const ns = await NumberingSequences.all()
    const invoice = ns.find((n) => /invoice|τιμολ/i.test(n.document_type) || /invoice|τιμολ/i.test(n.name))
    if (invoice) patch.default_numbering_sequence_id = invoice.id
    else if (ns.length) patch.default_numbering_sequence_id = ns[0]!.id
  }
  if (!settings.default_notice_numbering_sequence_id) {
    const ns = await NumberingSequences.all()
    const notice = ns.find((n) => /notice|παραγγελ|προσφορ/i.test(n.document_type) || /notice|παραγγελ|προσφορ/i.test(n.name))
    if (notice) patch.default_notice_numbering_sequence_id = notice.id
  }
  if (!settings.default_payment_method_id) {
    const pms = await PaymentMethods.all()
    if (pms.length) patch.default_payment_method_id = pms[0]!.id
  }
  if (!settings.default_logo_id) {
    const ls = await Logos.all()
    const def = ls.find((l) => l.is_default)
    if (def) patch.default_logo_id = def.id
    else if (ls.length) patch.default_logo_id = ls[0]!.id
  }
  if (!settings.default_measurement_unit_id) {
    const mus = await MeasurementUnits.all()
    const tmx = mus.find((m) => /TMX|ΤΜΧ|PCS|PIECE/i.test(m.abbreviation))
    if (tmx) patch.default_measurement_unit_id = tmx.id
    else if (mus.length) patch.default_measurement_unit_id = mus[0]!.id
  }
  if (Object.keys(patch).length) await updateSettings(patch)
}

export async function getCounts(): Promise<Record<string, number>> {
  const [products, contacts, taxes, warehouses, categories, units, pms, ns, logos, bas, vars, draftsAll] =
    await Promise.all([
      Products.count(),
      Contacts.count(),
      Taxes.count(),
      Warehouses.count(),
      Categories.count(),
      MeasurementUnits.count(),
      PaymentMethods.count(),
      NumberingSequences.count(),
      Logos.count(),
      BusinessAreas.count(),
      Variations.count(),
      Drafts.all().then((d) => d.length),
    ])
  return {
    products,
    contacts,
    taxes,
    warehouses,
    product_categories: categories,
    measurement_units: units,
    payment_methods: pms,
    numbering_sequences: ns,
    logos,
    business_areas: bas,
    variations: vars,
    drafts: draftsAll,
  }
}

export { STORES }
