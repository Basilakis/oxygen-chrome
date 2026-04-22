import { sendMessage } from '@/shared/messages'
import type {
  Logo,
  MeasurementUnit,
  NumberingSequence,
  PaymentMethod,
  ProductCategory,
  Settings,
  Tax,
  Warehouse,
} from '@/shared/types'

export async function renderDefaults(root: HTMLElement): Promise<void> {
  root.innerHTML = '<h2>Προεπιλογές</h2><p class="muted">Χρησιμοποιούνται στη δημιουργία προϊόντων και δελτίων.</p>'

  const [settingsRes, taxesRes, whRes, catsRes, unitsRes, pmsRes, nsRes, logosRes] = await Promise.all([
    sendMessage({ type: 'settings/get' }),
    sendMessage({ type: 'lookups/get-taxes' }),
    sendMessage({ type: 'lookups/get-warehouses' }),
    sendMessage({ type: 'lookups/get-categories' }),
    sendMessage({ type: 'lookups/get-measurement-units' }),
    sendMessage({ type: 'lookups/get-payment-methods' }),
    sendMessage({ type: 'lookups/get-numbering-sequences' }),
    sendMessage({ type: 'lookups/get-logos' }),
  ])

  const settings = (settingsRes as { ok: true; settings: Settings }).settings
  const taxes = (taxesRes as { ok: true; taxes: Tax[] }).taxes ?? []
  const warehouses = (whRes as { ok: true; warehouses: Warehouse[] }).warehouses ?? []
  const cats = (catsRes as { ok: true; categories: ProductCategory[] }).categories ?? []
  const units = (unitsRes as { ok: true; measurement_units: MeasurementUnit[] }).measurement_units ?? []
  const pms = (pmsRes as { ok: true; payment_methods: PaymentMethod[] }).payment_methods ?? []
  const ns = (nsRes as { ok: true; numbering_sequences: NumberingSequence[] }).numbering_sequences ?? []
  const logos = (logosRes as { ok: true; logos: Logo[] }).logos ?? []

  const patch: Partial<Settings> = {}

  root.appendChild(
    pickerField('Προεπιλεγμένη αποθήκη', settings.default_warehouse_id, warehouses.map((w) => ({ id: w.id, label: w.name })), (v) => {
      patch.default_warehouse_id = v
    }),
  )
  root.appendChild(
    pickerField('Προεπιλεγμένη κατηγορία', settings.default_category_id, cats.map((c) => ({ id: String(c.id), label: c.name })), (v) => {
      patch.default_category_id = v
    }),
  )
  root.appendChild(
    pickerField('Προεπιλεγμένος ΦΠΑ', settings.default_vat_id, taxes.map((t) => ({ id: t.id, label: `${t.rate}%` })), (v) => {
      patch.default_vat_id = v
    }),
  )
  root.appendChild(
    pickerField('Αρίθμηση τιμολογίων', settings.default_numbering_sequence_id, ns.map((n) => ({ id: n.id, label: `${n.name} (${n.document_type})` })), (v) => {
      patch.default_numbering_sequence_id = v
    }),
  )
  root.appendChild(
    pickerField('Αρίθμηση δελτίων', settings.default_notice_numbering_sequence_id, ns.map((n) => ({ id: n.id, label: `${n.name} (${n.document_type})` })), (v) => {
      patch.default_notice_numbering_sequence_id = v
    }),
  )
  root.appendChild(
    pickerField('Τρόπος πληρωμής', settings.default_payment_method_id, pms.map((p) => ({ id: p.id, label: p.title_gr })), (v) => {
      patch.default_payment_method_id = v
    }),
  )
  root.appendChild(
    pickerField('Λογότυπο', settings.default_logo_id, logos.map((l) => ({ id: l.id, label: (l.is_default ? '★ ' : '') + (l.name ?? String(l.id)) })), (v) => {
      patch.default_logo_id = v
    }),
  )
  root.appendChild(
    pickerField('Προεπιλεγμένη μονάδα', settings.default_measurement_unit_id, units.map((u) => ({ id: u.id, label: u.abbreviation })), (v) => {
      patch.default_measurement_unit_id = v
    }),
  )

  const row = document.createElement('div')
  row.className = 'row'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'btn primary'
  saveBtn.textContent = 'Αποθήκευση'
  row.appendChild(saveBtn)
  const status = document.createElement('span')
  status.className = 'hint'
  row.appendChild(status)
  root.appendChild(row)

  saveBtn.addEventListener('click', async () => {
    const res = await sendMessage({ type: 'settings/update', patch })
    status.innerHTML = res.ok ? '<span class="ok">Αποθηκεύτηκε</span>' : `<span class="err">${(res as { error: string }).error}</span>`
  })
}

function pickerField(
  label: string,
  current: string | undefined,
  options: Array<{ id: string; label: string }>,
  onChange: (value: string) => void,
): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'field'
  const title = document.createElement('span')
  title.textContent = label
  wrap.appendChild(title)
  const select = document.createElement('select')
  const none = document.createElement('option')
  none.value = ''
  none.textContent = '— καμία —'
  select.appendChild(none)
  for (const o of options) {
    const opt = document.createElement('option')
    opt.value = o.id
    opt.textContent = o.label
    if (current === o.id) opt.selected = true
    select.appendChild(opt)
  }
  select.addEventListener('change', () => {
    if (select.value) onChange(select.value)
  })
  wrap.appendChild(select)
  return wrap
}
