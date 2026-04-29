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

let running = false

export function isIncrementalRunning(): boolean {
  return running
}

export async function runIncremental(): Promise<void> {
  if (running) return
  running = true
  try {
    const startedAt = Date.now()
    const steps: Array<{ name: string; run: () => Promise<void> }> = [
      { name: 'taxes', run: async () => await Taxes.replaceAll(await getTaxes()) },
      { name: 'warehouses', run: async () => await Warehouses.replaceAll(await getWarehouses()) },
      { name: 'product_categories', run: async () => await Categories.replaceAll(await getProductCategories()) },
      { name: 'measurement_units', run: async () => await MeasurementUnits.replaceAll(await getMeasurementUnits()) },
      { name: 'payment_methods', run: async () => await PaymentMethods.replaceAll(await getPaymentMethods()) },
      { name: 'numbering_sequences', run: async () => await NumberingSequences.replaceAll(await getNumberingSequences()) },
      { name: 'logos', run: async () => await Logos.replaceAll(await getLogos()) },
      { name: 'business_areas', run: async () => await BusinessAreas.replaceAll(await getBusinessAreas()) },
      // Variations were missing from the incremental sync — only bootstrap
      // pulled them. That meant new variation types created via the Oxygen
      // API never showed up in the prefill modal's dropdown until the user
      // manually ran Πλήρης συγχρονισμός.
      { name: 'variations', run: async () => await Variations.replaceAll(await getVariations()) },
      { name: 'contacts', run: async () => await Contacts.replaceAll(await getContacts()) },
      { name: 'products', run: async () => await Products.replaceAll(await getProducts()) },
    ]
    for (const step of steps) {
      try {
        await step.run()
        await Sync.put({ resource: step.name, last_run_at: Date.now(), last_success_at: Date.now() })
      } catch (err) {
        await Sync.put({ resource: step.name, last_run_at: Date.now(), last_error: String((err as Error)?.message ?? err) })
        throw err
      }
    }
    await rebuildFromDB()
    await Sync.put({ resource: '__incremental__', last_run_at: startedAt, last_success_at: Date.now() })
  } finally {
    running = false
  }
}
