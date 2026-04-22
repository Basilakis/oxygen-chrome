import { Drafts, Products, Taxes } from '@/background/storage/stores'
import { getSettings, updateSettings } from '@/background/storage/settings'
import { createInvoice, createNotice } from '@/background/api/endpoints'
import type {
  Draft,
  DraftLine,
  Id,
  InvoiceLinePayload,
  NoticeCreatePayload,
  InvoiceCreatePayload,
} from '@/shared/types'
import { round2, todayIso, uid } from '@/shared/util'

export async function listDrafts(): Promise<Draft[]> {
  const all = await Drafts.all()
  return all.sort((a, b) => b.updated_at - a.updated_at)
}

export async function getDraft(id: string): Promise<Draft | null> {
  const d = await Drafts.get(id)
  return d ?? null
}

export async function getActiveDraft(): Promise<Draft | null> {
  const settings = await getSettings()
  if (!settings.active_draft_id) return null
  return (await Drafts.get(settings.active_draft_id)) ?? null
}

export async function createDraft(header: Partial<Draft> = {}): Promise<Draft> {
  const now = Date.now()
  const settings = await getSettings()
  const draft: Draft = {
    id: uid('d_'),
    status: 'active',
    contact_id: header.contact_id ?? null,
    numbering_sequence_id:
      header.numbering_sequence_id ??
      settings.default_notice_numbering_sequence_id ??
      settings.default_numbering_sequence_id ??
      null,
    issue_date: header.issue_date ?? todayIso(),
    language: header.language ?? 'el',
    description: header.description,
    lines: header.lines ?? [],
    created_at: now,
    updated_at: now,
  }
  await Drafts.put(draft)
  await updateSettings({ active_draft_id: draft.id })
  return draft
}

export async function setActiveDraft(id: string | null): Promise<void> {
  await updateSettings({ active_draft_id: id ?? undefined })
}

export async function updateDraft(id: string, patch: Partial<Draft>): Promise<Draft> {
  const current = await Drafts.get(id)
  if (!current) throw new Error(`draft ${id} not found`)
  const next: Draft = { ...current, ...patch, updated_at: Date.now() }
  await Drafts.put(next)
  return next
}

export async function deleteDraft(id: string): Promise<void> {
  await Drafts.delete(id)
  const settings = await getSettings()
  if (settings.active_draft_id === id) await updateSettings({ active_draft_id: undefined })
}

export async function addLine(
  draftId: string,
  line: Partial<DraftLine> & { source: DraftLine['source'] },
): Promise<Draft> {
  const current = await Drafts.get(draftId)
  if (!current) throw new Error(`draft ${draftId} not found`)
  const newLine: DraftLine = {
    id: uid('l_'),
    source: line.source,
    matched_product_id: line.matched_product_id ?? null,
    status: line.status ?? 'unmatched',
    payload: line.payload ?? {},
    note: line.note,
    error: line.error,
  }
  const next: Draft = {
    ...current,
    lines: [...current.lines, newLine],
    updated_at: Date.now(),
  }
  await Drafts.put(next)
  return next
}

export async function updateLine(
  draftId: string,
  lineId: string,
  patch: Partial<DraftLine>,
): Promise<Draft> {
  const current = await Drafts.get(draftId)
  if (!current) throw new Error(`draft ${draftId} not found`)
  const lines = current.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l))
  const next: Draft = { ...current, lines, updated_at: Date.now() }
  await Drafts.put(next)
  return next
}

export async function removeLine(draftId: string, lineId: string): Promise<Draft> {
  const current = await Drafts.get(draftId)
  if (!current) throw new Error(`draft ${draftId} not found`)
  const next: Draft = {
    ...current,
    lines: current.lines.filter((l) => l.id !== lineId),
    updated_at: Date.now(),
  }
  await Drafts.put(next)
  return next
}

export async function matchLineToProduct(
  draftId: string,
  lineId: string,
  productId: Id,
): Promise<Draft> {
  const product = await Products.get(productId)
  if (!product) throw new Error(`product ${productId} not found`)
  const settings = await getSettings()

  // Product stores sale_vat_ratio directly as a percentage. If absent, fall back to
  // the configured default VAT id → its rate.
  let rate = product.sale_vat_ratio
  let taxId: Id | undefined
  if (rate === undefined && settings.default_vat_id) {
    const defaultTax = await Taxes.get(settings.default_vat_id)
    rate = defaultTax?.rate
    taxId = defaultTax?.id
  }
  if (rate === undefined) rate = 24
  if (!taxId) {
    const taxes = await Taxes.all()
    const match = taxes.find((t) => Math.round(t.rate) === Math.round(rate as number))
    taxId = match?.id
  }

  const unitNet = product.sale_net_amount ?? 0
  const qty = 1

  return updateLine(draftId, lineId, {
    matched_product_id: productId,
    status: 'matched',
    payload: {
      description: product.name,
      quantity: qty,
      unit_net_value: unitNet,
      tax_id: taxId,
      vat_ratio: rate,
      net_amount: round2(unitNet * qty),
      vat_amount: round2(unitNet * qty * (rate / 100)),
      code: product.code,
    },
  })
}

function toLinePayload(line: DraftLine, rateLookup: (taxId: Id) => number): InvoiceLinePayload {
  const qty = Number(line.payload.quantity ?? 1)

  // When a product code is set (matched line), the server resolves the rest from
  // the product and we only need `code` + `quantity`. Manual lines need the full
  // breakdown including mydata classification.
  if (line.payload.code && line.matched_product_id) {
    return {
      code: line.payload.code,
      quantity: qty,
    }
  }

  const unit = Number(line.payload.unit_net_value ?? 0)
  const taxId = line.payload.tax_id
  const rate = taxId ? rateLookup(taxId) : 24
  const net = round2(qty * unit)
  const vat = round2(net * (rate / 100))
  return {
    description: line.payload.description ?? '',
    quantity: qty,
    unit_net_value: unit,
    tax_id: taxId,
    net_amount: net,
    vat_amount: vat,
    measurement_unit_id: line.payload.measurement_unit_id,
    // myDATA classification is required when sending a manual (non-code) line.
    // Defaults cover the common case of product sales; users can override via the
    // source product's classification once we wire that through.
    mydata_classification_category: line.payload.mydata_classification_category ?? 'category1_1',
    mydata_classification_type: line.payload.mydata_classification_type ?? 'E3_561_001',
  }
}

export async function submitDraftAsNotice(draftId: string): Promise<{ draft: Draft; notice_id: Id }> {
  const current = await Drafts.get(draftId)
  if (!current) throw new Error(`draft ${draftId} not found`)

  const unresolved = current.lines.filter((l) => l.status === 'unmatched' || l.status === 'needs_create')
  if (unresolved.length) throw new Error(`${unresolved.length} lines are not resolved`)
  if (!current.contact_id) throw new Error('draft has no contact_id')
  if (!current.lines.length) throw new Error('draft has no lines')

  const taxes = await Taxes.all()
  const rateLookup = (id: Id) => taxes.find((t) => t.id === id)?.rate ?? 24

  const settings = await getSettings()
  const payload: NoticeCreatePayload = {
    numbering_sequence_id: current.numbering_sequence_id ?? undefined,
    contact_id: current.contact_id,
    issue_date: current.issue_date ?? todayIso(),
    language: current.language ?? 'el',
    logo_id: settings.default_logo_id,
    description: current.description,
    items: current.lines.map((l) => toLinePayload(l, rateLookup)),
  }

  const result = await createNotice(payload)
  const noticeId = (result as { id: Id }).id
  const updated = await updateDraft(draftId, {
    status: 'submitted',
    submitted_notice_id: noticeId,
  })
  return { draft: updated, notice_id: noticeId }
}

export async function convertSubmittedDraftToInvoice(
  draftId: string,
): Promise<{ draft: Draft; invoice_id: Id }> {
  const current = await Drafts.get(draftId)
  if (!current) throw new Error(`draft ${draftId} not found`)
  if (!current.submitted_notice_id) throw new Error('draft has not been submitted as a notice')
  if (!current.contact_id) throw new Error('draft has no contact_id')
  if (!current.lines.length) throw new Error('draft has no lines')
  const unresolved = current.lines.filter((l) => l.status === 'unmatched' || l.status === 'needs_create')
  if (unresolved.length) throw new Error(`${unresolved.length} lines are not resolved`)

  const settings = await getSettings()
  const numberingSeq =
    current.numbering_sequence_id ?? settings.default_numbering_sequence_id
  if (!numberingSeq) throw new Error('no invoice numbering_sequence configured')

  const taxes = await Taxes.all()
  const rateLookup = (id: Id) => taxes.find((t) => t.id === id)?.rate ?? 24

  if (!settings.default_payment_method_id) {
    throw new Error('no default_payment_method_id configured — set one in Options → Defaults')
  }

  const payload: InvoiceCreatePayload = {
    numbering_sequence_id: numberingSeq,
    contact_id: current.contact_id,
    issue_date: todayIso(),
    language: current.language ?? 'el',
    logo_id: settings.default_logo_id,
    payment_method_id: settings.default_payment_method_id,
    // myDATA defaults: "p" = product invoice, mydata doc type "1.1" = Τιμολόγιο Πώλησης.
    // Services would use "s" / "2.1". Expose these in the UI when we implement the
    // convert-to-invoice prompt with an explicit document-type selector.
    document_type: 'p',
    mydata_document_type: '1.1',
    notice_id: current.submitted_notice_id,
    items: current.lines.map((l) => toLinePayload(l, rateLookup)),
  }

  const result = await createInvoice(payload)
  const invoiceId = (result as { id: Id }).id
  const updated = await updateDraft(draftId, { submitted_invoice_id: invoiceId })
  return { draft: updated, invoice_id: invoiceId }
}
