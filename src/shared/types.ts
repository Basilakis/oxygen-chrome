export type Id = string

export interface Tax {
  id: Id
  title: string
  rate: number
  is_default?: boolean
  mydata_vat_code?: string
  mydata_vat_exemption_category?: number | string
  status?: boolean | number
}

export interface Warehouse {
  id: Id
  name: string
  status?: boolean
}

export interface ProductCategory {
  id: Id
  name: string
  status?: boolean
  parent_id?: Id | null
}

export interface MeasurementUnit {
  id: Id
  abbreviation: string
  abbreviation_en?: string
  title?: string
  title_en?: string
  mydata_code?: string
  peppol_code?: string
}

export interface PaymentMethod {
  id: Id
  title_gr: string
  title_en?: string
  mydata_code?: string
  status?: boolean
}

export interface NumberingSequence {
  id: Id
  document_type: string
  name: string
  title?: string | null
  is_draft?: boolean
  status?: boolean | number
}

export interface Logo {
  id: Id
  is_default?: boolean
  name?: string
  url?: string
}

export interface BusinessArea {
  id: Id
  code?: string
  name?: string
}

export interface VariationValue {
  id: Id
  name: string
}

export interface Variation {
  id: Id
  name: string
  name_en?: string
  values: VariationValue[]
}

export interface ProductVariationLink {
  variation_id: Id
  variation_name?: string
  variation_value_id: Id
  variation_value_name?: string
}

export interface ProductWarehouseStock {
  id?: Id
  warehouse_id?: Id
  name?: string
  quantity: number
  position?: string
}

export interface Product {
  id: Id
  code: string
  name: string
  type?: number
  category?: ProductCategory | null
  category_id?: Id
  category_name?: string
  barcode?: string | null
  mpn_isbn?: string | null
  part_number?: string | null
  metric?: string
  quantity?: number
  warehouses?: ProductWarehouseStock[]
  sale_net_amount?: number
  sale_vat_ratio?: number
  sale_vat_amount?: number
  sale_total_amount?: number
  purchase_net_amount?: number
  purchase_vat_ratio?: number
  purchase_vat_amount?: number
  purchase_total_amount?: number
  profit_ratio?: number
  profit_amount?: number
  status?: boolean
  notes?: string | null
  mydata_income_category?: string | null
  mydata_income_type?: string | null
  mydata_income_retail_category?: string | null
  mydata_income_retail_type?: string | null
  supplier_id?: Id
  supplier_code?: string | null
  updated_at?: string
  // Additional fields surfaced in the Oxygen create-product UI
  cpv_code?: string | null
  taric_code?: string | null
  stock_threshold?: number | null
  no_stock_threshold?: boolean
  prices_include_vat?: boolean
  sale_discount_percent?: number
  measurement_unit_id?: Id
  // Variation children carry links back to the variation type + value.
  variations?: ProductVariationLink[]
}

export interface Contact {
  id: Id
  code?: string
  type?: number
  is_client?: boolean
  is_supplier?: boolean
  name?: string
  surname?: string
  nickname?: string
  company_name?: string
  vat_number?: string
  profession?: string
  street?: string
  number?: string
  city?: string
  zip_code?: string
  country?: string
  tax_office?: string
  email?: string
  phone?: string
  status?: boolean
}

export type DocumentType = 's' | 'p' | 'rs' | 'rp' | string

export interface InvoiceLinePayload {
  description?: string
  quantity: number
  unit_net_value?: number
  tax_id?: Id
  vat_ratio?: number
  net_amount?: number
  vat_amount?: number
  measurement_unit_id?: Id
  code?: string
  mydata_classification_category?: string
  mydata_classification_type?: string
}

export interface NoticeCreatePayload {
  numbering_sequence_id?: Id
  contact_id: Id
  issue_date: string
  expire_date?: string
  language: 'el' | 'en'
  logo_id?: Id
  description?: string
  items: InvoiceLinePayload[]
}

export interface InvoiceCreatePayload {
  numbering_sequence_id?: Id
  contact_id: Id
  issue_date: string
  expire_date?: string
  language: 'el' | 'en'
  logo_id?: Id
  payment_method_id: Id
  document_type: DocumentType
  mydata_document_type: string
  notice_id?: Id
  items: InvoiceLinePayload[]
}

export type DraftLineStatus = 'unmatched' | 'matched' | 'manual' | 'needs_create'

export interface DraftLineSource {
  url?: string
  title?: string
  selection?: string
  captured_at: number
}

export interface DraftLine {
  id: string
  source: DraftLineSource
  matched_product_id?: Id | null
  payload: Partial<InvoiceLinePayload>
  status: DraftLineStatus
  discount_percent?: number
  unit_label?: string
  note?: string
  error?: string
}

export interface Draft {
  id: string
  status: 'active' | 'submitted' | 'archived'
  contact_id?: Id | null
  numbering_sequence_id?: Id | null
  issue_date?: string
  expire_date?: string
  business_area_id?: Id | null
  prices_include_vat?: boolean
  language?: 'el' | 'en'
  description?: string
  lines: DraftLine[]
  created_at: number
  updated_at: number
  submitted_notice_id?: Id
  submitted_invoice_id?: Id
}

export interface SyncMeta {
  resource: string
  last_run_at: number
  last_success_at?: number
  last_error?: string
  count?: number
}

export interface VatCheckResult {
  vat_number: string
  company_name?: string
  profession?: string
  street?: string
  number?: string
  city?: string
  zip_code?: string
  country?: string
  tax_office?: string
  is_valid?: boolean
  raw?: unknown
}

export type SkuStrategy = 'auto' | 'numeric' | 'prefixed' | 'category'

export interface Settings {
  base_url: string
  mode: 'sandbox' | 'production'
  token?: string
  default_warehouse_id?: Id
  default_category_id?: Id
  default_vat_id?: Id
  default_numbering_sequence_id?: Id
  default_payment_method_id?: Id
  default_logo_id?: Id
  default_measurement_unit_id?: Id
  default_notice_numbering_sequence_id?: Id
  sku_strategy: SkuStrategy
  sku_prefix: string
  sku_seq_padding: number
  markup_percent: number
  auto_link_suppliers: boolean
  auto_detect_products: boolean
  sync_interval_minutes: number
  notifications_enabled: boolean
  active_draft_id?: string
  // AI assistant (BYOK Claude)
  anthropic_api_key?: string
  anthropic_model: string
  agent_enabled: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  base_url: 'https://api.oxygen.gr/v1',
  mode: 'sandbox',
  sku_strategy: 'auto',
  sku_prefix: '',
  sku_seq_padding: 0,
  markup_percent: 25,
  auto_link_suppliers: true,
  auto_detect_products: true,
  sync_interval_minutes: 60,
  notifications_enabled: true,
  anthropic_model: 'claude-sonnet-4-6',
  agent_enabled: true,
}
