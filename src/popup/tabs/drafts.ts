import { sendMessage } from '@/shared/messages'
import type {
  BusinessArea,
  Contact,
  Draft,
  DraftLine,
  Id,
  MeasurementUnit,
  NumberingSequence,
  Tax,
} from '@/shared/types'
import { debounce, formatMoney, round2, todayIso, uid } from '@/shared/util'

interface EditorCtx {
  taxes: Tax[]
  units: MeasurementUnit[]
  numbering: NumberingSequence[]
  areas: BusinessArea[]
  defaultVatId?: Id
  defaultNoticeNumberingId?: Id
  defaultBusinessAreaId?: Id
  defaultExpireDays: number
}

export async function renderDraftsTab(root: HTMLElement): Promise<void> {
  root.innerHTML = '<p class="muted">Φόρτωση…</p>'

  const [listRes, activeRes, settingsRes, taxesRes, unitsRes, nsRes, areasRes] = await Promise.all([
    sendMessage({ type: 'drafts/list' }),
    sendMessage({ type: 'drafts/get-active' }),
    sendMessage({ type: 'settings/get' }),
    sendMessage({ type: 'lookups/get-taxes' }),
    sendMessage({ type: 'lookups/get-measurement-units' }),
    sendMessage({ type: 'lookups/get-numbering-sequences' }),
    sendMessage({ type: 'lookups/get-business-areas' }),
  ])

  const drafts = (listRes as { ok: true; drafts: Draft[] }).drafts ?? []
  const active = (activeRes as { ok: true; draft: Draft | null }).draft ?? null
  const settings = (settingsRes as { ok: true; settings: { default_vat_id?: Id; default_notice_numbering_sequence_id?: Id } }).settings
  const taxes = (taxesRes as { ok: true; taxes: Tax[] }).taxes ?? []
  const units = (unitsRes as { ok: true; measurement_units: MeasurementUnit[] }).measurement_units ?? []
  const numbering = (nsRes as { ok: true; numbering_sequences: NumberingSequence[] }).numbering_sequences ?? []
  const areas = (areasRes as { ok: true; business_areas: BusinessArea[] }).business_areas ?? []

  const ctx: EditorCtx = {
    taxes,
    units,
    numbering,
    areas,
    defaultVatId: settings.default_vat_id,
    defaultNoticeNumberingId: settings.default_notice_numbering_sequence_id,
    defaultExpireDays: 15,
  }

  root.innerHTML = ''

  // ---- toolbar ----
  root.appendChild(buildToolbar(drafts, active, () => renderDraftsTab(root)))

  // ---- draft list (always shown so users can always navigate / delete,
  // even when there's only one active draft) ----
  if (drafts.length) {
    root.appendChild(buildDraftList(drafts, active, () => renderDraftsTab(root)))
  }

  // ---- active editor ----
  if (active) {
    root.appendChild(buildEditor(active, ctx, () => renderDraftsTab(root)))
  } else if (!drafts.length) {
    root.appendChild(
      createDiv('muted', 'Δεν υπάρχει ενεργή ειδοποίηση. Δημιούργησε μια νέα ή καρφίτσωσε ένα προϊόν από μια σελίδα.'),
    )
  }
}

/* -------------------------------------------------- toolbar + list -- */

function buildToolbar(_drafts: Draft[], _active: Draft | null, refresh: () => void): HTMLElement {
  const row = document.createElement('div')
  row.className = 'row'
  row.style.marginBottom = '10px'

  const newBtn = document.createElement('button')
  newBtn.className = 'btn primary'
  newBtn.textContent = '+ Νέα ειδοποίηση'
  newBtn.addEventListener('click', async () => {
    const res = await sendMessage({ type: 'drafts/create' })
    if (res.ok) refresh()
  })
  row.appendChild(newBtn)

  return row
}

function buildDraftList(drafts: Draft[], active: Draft | null, refresh: () => void): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'stack'
  wrap.style.marginBottom = '12px'
  for (const d of drafts) wrap.appendChild(draftRow(d, active?.id === d.id, refresh))
  return wrap
}

function draftRow(d: Draft, isActive: boolean, refresh: () => void): HTMLElement {
  const box = document.createElement('div')
  box.className = 'draft' + (isActive ? ' active' : '')

  const title = document.createElement('div')
  title.className = 'title'
  const icon = d.status === 'submitted' ? '✅' : d.status === 'archived' ? '📦' : '📝'
  title.textContent = `${icon} ${d.id.slice(0, 10)}…`
  box.appendChild(title)

  const sub = document.createElement('div')
  sub.className = 'sub'
  const total = computeDraftTotal(d)
  sub.textContent = `${d.lines.length} γραμμές · ${formatMoney(total.gross)} · ενημ. ${new Date(d.updated_at).toLocaleDateString('el-GR')}`
  box.appendChild(sub)

  const row = document.createElement('div')
  row.className = 'row'
  row.style.marginTop = '6px'

  if (!isActive) {
    const makeActive = document.createElement('button')
    makeActive.className = 'btn'
    makeActive.textContent = 'Ενεργοποίηση'
    makeActive.addEventListener('click', async () => {
      await sendMessage({ type: 'drafts/set-active', id: d.id })
      refresh()
    })
    row.appendChild(makeActive)
  }

  const del = document.createElement('button')
  del.className = 'btn danger'
  del.textContent = 'Διαγραφή'
  del.addEventListener('click', async () => {
    if (!confirm(`Διαγραφή ειδοποίησης;`)) return
    await sendMessage({ type: 'drafts/delete', id: d.id })
    refresh()
  })
  row.appendChild(del)
  box.appendChild(row)

  return box
}

/* ------------------------------------------------------ editor root -- */

function buildEditor(draft: Draft, ctx: EditorCtx, refresh: () => void): HTMLElement {
  // Make sure defaults are set on open — doesn't persist until user changes something
  if (!draft.issue_date) draft.issue_date = todayIso()
  if (!draft.expire_date) draft.expire_date = addDays(draft.issue_date, ctx.defaultExpireDays)
  if (!draft.numbering_sequence_id) draft.numbering_sequence_id = ctx.defaultNoticeNumberingId ?? null
  if (draft.prices_include_vat === undefined) draft.prices_include_vat = false

  const wrap = document.createElement('div')
  wrap.className = 'editor'

  wrap.appendChild(buildEditorHeader(draft, refresh))
  wrap.appendChild(buildContactSection(draft, ctx, refresh))
  wrap.appendChild(buildLinesSection(draft, ctx, refresh))
  wrap.appendChild(buildFooter(draft, refresh))

  return wrap
}

function buildEditorHeader(draft: Draft, refresh: () => void): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'editor-topbar'

  const left = document.createElement('div')
  left.className = 'editor-topbar-title'
  const icon = draft.status === 'submitted' ? '✅' : draft.status === 'archived' ? '📦' : '📝'
  left.innerHTML = `<span class="editor-topbar-icon">${icon}</span>
    <span class="editor-topbar-id">${draft.id}</span>
    <span class="editor-topbar-sub">· ${draft.lines.length} γραμμές</span>`
  bar.appendChild(left)

  const actions = document.createElement('div')
  actions.className = 'editor-topbar-actions'

  if (draft.status !== 'submitted') {
    const del = document.createElement('button')
    del.className = 'btn danger'
    del.type = 'button'
    del.textContent = '🗑 Διαγραφή'
    del.title = 'Διαγραφή ειδοποίησης'
    del.addEventListener('click', async () => {
      if (!confirm('Διαγραφή αυτής της ειδοποίησης;')) return
      await sendMessage({ type: 'drafts/delete', id: draft.id })
      refresh()
    })
    actions.appendChild(del)
  }

  bar.appendChild(actions)
  return bar
}

/* ------------------------------------------- Στοιχεία επαφής section -- */

function buildContactSection(draft: Draft, ctx: EditorCtx, _refresh: () => void): HTMLElement {
  const sec = document.createElement('section')
  sec.className = 'editor-section'
  sec.appendChild(sectionHead('Στοιχεία επαφής', '👤'))

  const grid = document.createElement('div')
  grid.className = 'contact-grid'
  sec.appendChild(grid)

  // --- Contact picker (left column) ---
  const contactCell = document.createElement('div')
  contactCell.className = 'cell-contact'
  grid.appendChild(contactCell)

  const contactLbl = labelRow('Επαφή')
  contactCell.appendChild(contactLbl)
  const contactSearch = document.createElement('input')
  contactSearch.type = 'text'
  contactSearch.placeholder = 'Αναζήτηση ή ΑΦΜ…'
  contactSearch.className = 'draft-input'
  contactSearch.autocomplete = 'off'
  contactLbl.appendChild(contactSearch)

  const dropdown = document.createElement('div')
  dropdown.className = 'contact-dropdown'
  dropdown.style.display = 'none'
  contactLbl.appendChild(dropdown)

  const detailsBox = document.createElement('div')
  detailsBox.className = 'contact-details'
  contactCell.appendChild(detailsBox)

  const renderDetails = (c: Contact | null): void => {
    detailsBox.innerHTML = ''
    const rows: Array<[string, string | undefined]> = [
      ['ΑΦΜ', c?.vat_number],
      ['Διεύθυνση', contactAddress(c)],
      ['Email', c?.email],
      ['Τηλέφωνο', c?.phone],
    ]
    for (const [k, v] of rows) {
      const row = document.createElement('div')
      row.className = 'contact-detail-row'
      const label = document.createElement('span')
      label.className = 'key'
      label.textContent = k
      const value = document.createElement('span')
      value.className = 'val'
      value.textContent = v || '-'
      row.appendChild(label)
      row.appendChild(value)
      detailsBox.appendChild(row)
    }
  }

  // load current contact
  if (draft.contact_id) {
    sendMessage({ type: 'contacts/get', id: draft.contact_id }).then((res) => {
      if (res.ok && 'contact' in res) {
        const c = res.contact as Contact
        contactSearch.value = c.company_name || c.name || c.vat_number || ''
        renderDetails(c)
      }
    })
  } else {
    renderDetails(null)
  }

  const runSearch = debounce(async (q: string) => {
    if (!q.trim()) {
      dropdown.style.display = 'none'
      return
    }
    const res = await sendMessage({ type: 'contacts/search', query: q, limit: 12 })
    if (!res.ok || !('contacts' in res)) {
      dropdown.style.display = 'none'
      return
    }
    const list = res.contacts as Contact[]
    dropdown.innerHTML = ''
    if (!list.length) {
      const empty = document.createElement('div')
      empty.className = 'contact-empty'
      empty.textContent = 'Καμία τοπική αντιστοίχιση. Δοκίμασε ακριβές ΑΦΜ για ανάκτηση από Oxygen.'
      dropdown.appendChild(empty)
      dropdown.style.display = 'block'
      return
    }
    for (const c of list) {
      const item = document.createElement('div')
      item.className = 'contact-item'
      const label = document.createElement('span')
      label.className = 'main'
      label.textContent = c.company_name || [c.name, c.surname].filter(Boolean).join(' ') || c.vat_number || '-'
      const vat = document.createElement('span')
      vat.className = 'sub'
      vat.textContent = c.vat_number ? `ΑΦΜ ${c.vat_number}` : ''
      item.appendChild(label)
      item.appendChild(vat)
      item.addEventListener('click', async () => {
        contactSearch.value = c.company_name || c.name || c.vat_number || ''
        dropdown.style.display = 'none'
        renderDetails(c)
        await sendMessage({
          type: 'drafts/update',
          id: draft.id,
          patch: { contact_id: c.id },
        })
      })
      dropdown.appendChild(item)
    }
    dropdown.style.display = 'block'
  }, 200)

  contactSearch.addEventListener('input', () => runSearch(contactSearch.value))
  contactSearch.addEventListener('focus', () => {
    if (contactSearch.value) runSearch(contactSearch.value)
  })
  document.addEventListener('click', (e) => {
    if (!contactLbl.contains(e.target as Node)) dropdown.style.display = 'none'
  })

  const newContactHint = document.createElement('div')
  newContactHint.className = 'hint'
  newContactHint.textContent = 'Δημιουργία νέας επαφής: καταχώρησε στο Oxygen και συγχρόνισε.'
  contactLbl.appendChild(newContactHint)

  // --- Right column (dates / numbering / area) ---
  const metaCell = document.createElement('div')
  metaCell.className = 'cell-meta'
  grid.appendChild(metaCell)

  metaCell.appendChild(
    labeledInput('Σειρά', (() => {
      const sel = document.createElement('select')
      sel.className = 'draft-input'
      sel.appendChild(mkOpt('', 'Χωρίς σειρά'))
      for (const n of ctx.numbering) sel.appendChild(mkOpt(n.id, `${n.name} (${n.document_type})`))
      if (draft.numbering_sequence_id) sel.value = draft.numbering_sequence_id
      sel.addEventListener('change', async () => {
        await sendMessage({
          type: 'drafts/update',
          id: draft.id,
          patch: { numbering_sequence_id: sel.value || null },
        })
      })
      return sel
    })()),
  )

  metaCell.appendChild(staticLine('No', '# Αυτόματα'))

  metaCell.appendChild(
    labeledInput('Ημ. Έκδοσης', (() => {
      const input = document.createElement('input')
      input.type = 'date'
      input.className = 'draft-input'
      input.value = draft.issue_date ?? todayIso()
      input.addEventListener('change', async () => {
        await sendMessage({
          type: 'drafts/update',
          id: draft.id,
          patch: { issue_date: input.value },
        })
      })
      return input
    })()),
  )

  metaCell.appendChild(
    labeledInput('Ημ. Λήξης', (() => {
      const input = document.createElement('input')
      input.type = 'date'
      input.className = 'draft-input'
      input.value = draft.expire_date ?? addDays(todayIso(), ctx.defaultExpireDays)
      input.addEventListener('change', async () => {
        await sendMessage({
          type: 'drafts/update',
          id: draft.id,
          patch: { expire_date: input.value },
        })
      })
      return input
    })()),
  )

  metaCell.appendChild(
    labeledInput('Κατηγορία', (() => {
      const sel = document.createElement('select')
      sel.className = 'draft-input'
      sel.appendChild(mkOpt('', 'Καμία'))
      for (const a of ctx.areas) {
        sel.appendChild(mkOpt(a.id, a.name || a.code || a.id))
      }
      if (draft.business_area_id) sel.value = draft.business_area_id
      sel.addEventListener('change', async () => {
        await sendMessage({
          type: 'drafts/update',
          id: draft.id,
          patch: { business_area_id: sel.value || null },
        })
      })
      return sel
    })()),
  )

  return sec
}

/* ----------------------------------- Υπηρεσίες & Προϊόντα section -- */

function buildLinesSection(draft: Draft, ctx: EditorCtx, refresh: () => void): HTMLElement {
  const sec = document.createElement('section')
  sec.className = 'editor-section'
  sec.appendChild(sectionHead('Υπηρεσίες & Προϊόντα', '🛒'))

  // Top controls
  const topRow = document.createElement('div')
  topRow.className = 'lines-top'
  const chkWrap = document.createElement('label')
  chkWrap.className = 'inline-check'
  const chk = document.createElement('input')
  chk.type = 'checkbox'
  chk.checked = !!draft.prices_include_vat
  chk.addEventListener('change', async () => {
    await sendMessage({
      type: 'drafts/update',
      id: draft.id,
      patch: { prices_include_vat: chk.checked },
    })
    refresh()
  })
  chkWrap.appendChild(chk)
  chkWrap.appendChild(document.createTextNode(' Η τιμή μονάδας περιλαμβάνει το ΦΠΑ'))
  topRow.appendChild(chkWrap)
  sec.appendChild(topRow)

  // Lines table (scrollable horizontally at narrow widths)
  const tableWrap = document.createElement('div')
  tableWrap.className = 'lines-table-wrap'
  const table = document.createElement('table')
  table.className = 'lines-table'
  const thead = document.createElement('thead')
  thead.innerHTML = `
    <tr>
      <th class="col-idx">#</th>
      <th class="col-search">Αναζήτηση</th>
      <th class="col-desc">Περιγραφή</th>
      <th class="col-unit">Μ/Μ</th>
      <th class="col-qty">Ποσ.</th>
      <th class="col-price">Τιμή €</th>
      <th class="col-disc">Έκπτωση</th>
      <th class="col-net">Αξία</th>
      <th class="col-vat">ΦΠΑ%</th>
      <th class="col-total">Τελική</th>
      <th class="col-rm"></th>
    </tr>
  `
  table.appendChild(thead)
  const tbody = document.createElement('tbody')
  table.appendChild(tbody)

  draft.lines.forEach((line, i) => {
    tbody.appendChild(buildLineRow(draft, line, i, ctx, refresh))
  })

  // Totals row
  const totals = computeDraftTotal(draft)
  const tfoot = document.createElement('tfoot')
  tfoot.innerHTML = `
    <tr>
      <td colspan="7" class="sum-label">ΣΥΝΟΛΟ</td>
      <td class="sum-value">${formatMoney(totals.net)}</td>
      <td></td>
      <td class="sum-value">${formatMoney(totals.gross)}</td>
      <td></td>
    </tr>
  `
  table.appendChild(tfoot)
  tableWrap.appendChild(table)
  sec.appendChild(tableWrap)

  // Add-line button
  const addRow = document.createElement('div')
  addRow.className = 'row'
  addRow.style.marginTop = '8px'
  const addBtn = document.createElement('button')
  addBtn.className = 'btn'
  addBtn.textContent = '+ Προσθήκη γραμμής'
  addBtn.addEventListener('click', async () => {
    await sendMessage({
      type: 'drafts/add-line',
      draft_id: draft.id,
      line: {
        source: { captured_at: Date.now() },
        status: 'manual',
        payload: { quantity: 1, unit_net_value: 0, tax_id: ctx.defaultVatId },
      },
    })
    refresh()
  })
  addRow.appendChild(addBtn)
  sec.appendChild(addRow)

  return sec
}

function buildLineRow(
  draft: Draft,
  line: DraftLine,
  index: number,
  ctx: EditorCtx,
  refresh: () => void,
): HTMLElement {
  const tr = document.createElement('tr')
  tr.className = 'line-row-table'
  const includesVat = !!draft.prices_include_vat
  const taxRate = resolveRate(line.payload.tax_id, ctx.taxes)

  // # index
  const idxCell = document.createElement('td')
  idxCell.className = 'col-idx'
  idxCell.textContent = String(index + 1)
  tr.appendChild(idxCell)

  // Αναζήτηση (product lookup)
  const searchCell = document.createElement('td')
  searchCell.className = 'col-search'
  const searchIn = document.createElement('input')
  searchIn.type = 'text'
  searchIn.className = 'draft-input compact'
  searchIn.placeholder = 'SKU…'
  searchIn.value = line.payload.code ?? ''
  searchIn.addEventListener('change', async () => {
    const code = searchIn.value.trim()
    if (!code) return
    const res = await sendMessage({ type: 'search/catalog', query: code, limit: 1 })
    if (res.ok && 'results' in res) {
      const r = res.results
      const hit = r.exact[0]?.product ?? r.fuzzy[0]?.product
      if (hit) {
        await sendMessage({
          type: 'drafts/match-line',
          draft_id: draft.id,
          line_id: line.id,
          product_id: hit.id,
        })
        refresh()
        return
      }
    }
    // Not found — store the code on the line
    await sendMessage({
      type: 'drafts/update-line',
      draft_id: draft.id,
      line_id: line.id,
      patch: { payload: { ...line.payload, code } },
    })
    refresh()
  })
  searchCell.appendChild(searchIn)
  tr.appendChild(searchCell)

  // Περιγραφή
  const descCell = document.createElement('td')
  descCell.className = 'col-desc'
  const descIn = document.createElement('input')
  descIn.type = 'text'
  descIn.className = 'draft-input'
  descIn.value = line.payload.description ?? line.source.selection ?? ''
  descIn.placeholder = '—'
  descIn.addEventListener('change', async () => {
    await sendMessage({
      type: 'drafts/update-line',
      draft_id: draft.id,
      line_id: line.id,
      patch: { payload: { ...line.payload, description: descIn.value } },
    })
  })
  descCell.appendChild(descIn)
  tr.appendChild(descCell)

  // Μ/Μ
  const unitCell = document.createElement('td')
  unitCell.className = 'col-unit'
  unitCell.textContent = line.unit_label ?? '---'
  tr.appendChild(unitCell)

  // Ποσότητα
  const qtyCell = document.createElement('td')
  qtyCell.className = 'col-qty'
  const qtyIn = numInput(line.payload.quantity ?? 1, { step: 1, min: 0 })
  qtyCell.appendChild(qtyIn)
  tr.appendChild(qtyCell)

  // Τιμή
  const priceCell = document.createElement('td')
  priceCell.className = 'col-price'
  const priceIn = numInput(line.payload.unit_net_value ?? 0, { step: 0.01, min: 0 })
  priceCell.appendChild(priceIn)
  tr.appendChild(priceCell)

  // Έκπτωση %
  const discCell = document.createElement('td')
  discCell.className = 'col-disc'
  const discIn = numInput(line.discount_percent ?? 0, { step: 0.01, min: 0, max: 100 })
  discCell.appendChild(discIn)
  const pct = document.createElement('span')
  pct.className = 'suffix'
  pct.textContent = '%'
  discCell.appendChild(pct)
  tr.appendChild(discCell)

  // Αξία (computed net)
  const netCell = document.createElement('td')
  netCell.className = 'col-net readonly'
  tr.appendChild(netCell)

  // ΦΠΑ%
  const vatCell = document.createElement('td')
  vatCell.className = 'col-vat'
  const vatSel = document.createElement('select')
  vatSel.className = 'draft-input compact'
  for (const t of ctx.taxes) vatSel.appendChild(mkOpt(t.id, `${round2(t.rate)}%`))
  if (line.payload.tax_id) vatSel.value = line.payload.tax_id
  else if (ctx.defaultVatId) vatSel.value = ctx.defaultVatId
  vatCell.appendChild(vatSel)
  tr.appendChild(vatCell)

  // Τελική (computed gross)
  const totalCell = document.createElement('td')
  totalCell.className = 'col-total readonly'
  tr.appendChild(totalCell)

  // × remove
  const rmCell = document.createElement('td')
  rmCell.className = 'col-rm'
  const rmBtn = document.createElement('button')
  rmBtn.className = 'btn-icon-sm'
  rmBtn.textContent = '×'
  rmBtn.title = 'Αφαίρεση'
  rmBtn.addEventListener('click', async () => {
    await sendMessage({ type: 'drafts/remove-line', draft_id: draft.id, line_id: line.id })
    refresh()
  })
  rmCell.appendChild(rmBtn)
  tr.appendChild(rmCell)

  // ------ recomputing logic ------
  const recompute = (): { net: number; gross: number } => {
    const qty = Number(qtyIn.value) || 0
    const price = Number(priceIn.value) || 0
    const disc = Number(discIn.value) || 0
    const selectedTaxId = vatSel.value
    const rate = resolveRate(selectedTaxId, ctx.taxes) ?? taxRate ?? 24
    let net: number, gross: number
    const afterDiscount = price * qty * (1 - disc / 100)
    if (includesVat) {
      gross = round2(afterDiscount)
      net = round2(gross / (1 + rate / 100))
    } else {
      net = round2(afterDiscount)
      gross = round2(net * (1 + rate / 100))
    }
    netCell.textContent = formatMoney(net)
    totalCell.textContent = formatMoney(gross)
    return { net, gross }
  }
  recompute()

  const persist = debounce(async () => {
    const { net, gross } = recompute()
    const selectedTaxId = vatSel.value || undefined
    const rate = resolveRate(selectedTaxId, ctx.taxes) ?? 24
    await sendMessage({
      type: 'drafts/update-line',
      draft_id: draft.id,
      line_id: line.id,
      patch: {
        discount_percent: Number(discIn.value) || 0,
        payload: {
          ...line.payload,
          quantity: Number(qtyIn.value) || 0,
          unit_net_value: Number(priceIn.value) || 0,
          tax_id: selectedTaxId,
          vat_ratio: rate,
          net_amount: net,
          vat_amount: round2(gross - net),
        },
      },
    })
    refresh()
  }, 400)

  for (const el of [qtyIn, priceIn, discIn]) {
    el.addEventListener('input', () => recompute())
    el.addEventListener('change', () => persist())
  }
  vatSel.addEventListener('change', () => persist())

  return tr
}

/* --------------------------------------------------- footer + submit -- */

function buildFooter(draft: Draft, refresh: () => void): HTMLElement {
  const sec = document.createElement('section')
  sec.className = 'editor-section submit-section'

  if (draft.status === 'submitted') {
    const ok = document.createElement('div')
    ok.className = 'ok'
    ok.textContent = `✓ Υποβλήθηκε ως Δελτίο #${draft.submitted_notice_id ?? ''}`
    sec.appendChild(ok)

    const convertBtn = document.createElement('button')
    convertBtn.className = 'btn primary'
    convertBtn.textContent = draft.submitted_invoice_id
      ? `✓ Τιμολόγιο #${draft.submitted_invoice_id}`
      : 'Μετατροπή σε Τιμολόγιο'
    convertBtn.disabled = !!draft.submitted_invoice_id
    convertBtn.addEventListener('click', async () => {
      convertBtn.disabled = true
      convertBtn.textContent = 'Μετατροπή…'
      const res = await sendMessage({ type: 'drafts/convert-to-invoice', draft_id: draft.id })
      if (!res.ok) alert(`Αποτυχία: ${(res as { error: string }).error}`)
      refresh()
    })
    sec.appendChild(convertBtn)
    return sec
  }

  const unresolved = draft.lines.filter((l) => l.status === 'unmatched' || l.status === 'needs_create')
  const canSubmit = draft.lines.length > 0 && draft.contact_id && !unresolved.length

  const submitBtn = document.createElement('button')
  submitBtn.className = 'btn primary'
  submitBtn.textContent = 'Υποβολή ως Δελτίο'
  submitBtn.disabled = !canSubmit
  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true
    submitBtn.textContent = 'Υποβολή…'
    const res = await sendMessage({ type: 'drafts/submit', draft_id: draft.id })
    if (!res.ok) {
      alert(`Αποτυχία: ${(res as { error: string }).error}`)
      submitBtn.disabled = false
      submitBtn.textContent = 'Υποβολή ως Δελτίο'
      return
    }
    refresh()
  })
  sec.appendChild(submitBtn)

  if (!draft.contact_id) {
    sec.appendChild(createDiv('hint err', 'Επίλεξε πρώτα πελάτη.'))
  } else if (unresolved.length) {
    sec.appendChild(createDiv('hint err', `${unresolved.length} γραμμές δεν είναι αντιστοιχισμένες.`))
  } else if (!draft.lines.length) {
    sec.appendChild(createDiv('hint', 'Η ειδοποίηση δεν έχει γραμμές.'))
  }

  return sec
}

/* -------------------------------------------------------- helpers -- */

function sectionHead(title: string, icon: string): HTMLElement {
  const head = document.createElement('div')
  head.className = 'editor-head'
  const ic = document.createElement('span')
  ic.className = 'editor-head-icon'
  ic.textContent = icon
  head.appendChild(ic)
  const t = document.createElement('span')
  t.textContent = title
  head.appendChild(t)
  return head
}

function labelRow(text: string): HTMLLabelElement {
  const lbl = document.createElement('label')
  lbl.className = 'field-row'
  const key = document.createElement('span')
  key.className = 'key'
  key.textContent = text
  lbl.appendChild(key)
  return lbl
}

function labeledInput(text: string, control: HTMLElement): HTMLElement {
  const row = labelRow(text)
  row.appendChild(control)
  return row
}

function staticLine(key: string, value: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'field-row readonly'
  const k = document.createElement('span')
  k.className = 'key'
  k.textContent = key
  const v = document.createElement('span')
  v.className = 'val'
  v.textContent = value
  row.appendChild(k)
  row.appendChild(v)
  return row
}

function mkOpt(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option')
  o.value = value
  o.textContent = label
  return o
}

function numInput(value: number, attrs: { step?: number; min?: number; max?: number }): HTMLInputElement {
  const i = document.createElement('input')
  i.type = 'number'
  i.className = 'draft-input compact'
  if (attrs.step !== undefined) i.step = String(attrs.step)
  if (attrs.min !== undefined) i.min = String(attrs.min)
  if (attrs.max !== undefined) i.max = String(attrs.max)
  i.value = String(value)
  return i
}

function createDiv(className: string, text: string): HTMLElement {
  const d = document.createElement('div')
  d.className = className
  d.textContent = text
  return d
}

function contactAddress(c: Contact | null | undefined): string | undefined {
  if (!c) return undefined
  const parts = [c.street, c.number, c.city, c.zip_code].filter((x) => x && String(x).trim())
  return parts.length ? parts.join(' ') : undefined
}

function resolveRate(taxId: Id | undefined, taxes: Tax[]): number | undefined {
  if (!taxId) return undefined
  return taxes.find((t) => t.id === taxId)?.rate
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function computeDraftTotal(draft: Draft): { net: number; vat: number; gross: number } {
  const includesVat = !!draft.prices_include_vat
  let net = 0
  let gross = 0
  for (const l of draft.lines) {
    const qty = Number(l.payload.quantity ?? 0)
    const price = Number(l.payload.unit_net_value ?? 0)
    const disc = Number(l.discount_percent ?? 0)
    const rate = Number(l.payload.vat_ratio ?? 24)
    const afterDiscount = qty * price * (1 - disc / 100)
    if (includesVat) {
      gross += afterDiscount
      net += afterDiscount / (1 + rate / 100)
    } else {
      net += afterDiscount
      gross += afterDiscount * (1 + rate / 100)
    }
  }
  return { net: round2(net), vat: round2(gross - net), gross: round2(gross) }
}

/* Allow legacy draft-line creation to work without `unit_label` existing */
void uid
