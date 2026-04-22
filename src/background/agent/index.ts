import { getSettings } from '@/background/storage/settings'
import {
  callAnthropic,
  type AnthropicContentBlock,
  type AnthropicMessage,
} from './client'
import { SYSTEM_PROMPT } from './prompt'
import { TOOL_DEFS, executeTool } from './tools'
import type { ScrapedInvoice } from '@/shared/messages'

const MAX_TOKENS = 4096
const MAX_ITERATIONS = 8 // safety bound on tool-use loops

export interface AgentAttachment {
  fileName: string
  mimeType: string
  dataBase64: string
}

export interface AgentTurn {
  role: 'user' | 'assistant'
  content: string
  tool_calls?: Array<{ name: string; input: Record<string, unknown>; result?: unknown }>
}

export type PendingAction =
  | { type: 'open_prefill_form'; invoice: ScrapedInvoice; supplier_name?: string }

export interface AgentResult {
  assistant_text: string
  tool_calls: Array<{ name: string; input: Record<string, unknown>; result: unknown }>
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
  }
  history: AnthropicMessage[]
  /**
   * UI side-effects the agent requested. The popup consumes these to open
   * overlays / trigger follow-up flows that can't run inside the SW.
   */
  pending_actions: PendingAction[]
}

/**
 * Run one user-initiated agent turn. Handles:
 *   - file attachments (PDF / image) folded into the first user message
 *   - the tool-use loop (Claude → tool → tool_result → Claude …)
 *   - capture of `prepare_invoice_creation` tool calls as a pending UI action
 *     for the popup to open the prefill form
 */
export async function runAgentTurn(
  userText: string,
  priorHistory: AnthropicMessage[] = [],
  attachments: AgentAttachment[] = [],
): Promise<AgentResult> {
  const settings = await getSettings()
  const model = settings.anthropic_model || 'claude-sonnet-4-6'

  // Fold attachments into the first user message as document/image blocks.
  const userContent: AnthropicContentBlock[] = []
  for (const att of attachments) {
    if (att.mimeType === 'application/pdf') {
      userContent.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: att.dataBase64 },
      })
    } else if (att.mimeType.startsWith('image/')) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mimeType === 'image/jpg' ? 'image/jpeg' : att.mimeType,
          data: att.dataBase64,
        },
      })
    }
  }
  userContent.push({ type: 'text', text: userText })

  const messages: AnthropicMessage[] = [
    ...priorHistory,
    { role: 'user', content: attachments.length ? userContent : userText },
  ]

  const toolCalls: Array<{ name: string; input: Record<string, unknown>; result: unknown }> = []
  const pendingActions: PendingAction[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 }
  let finalText = ''

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const res = await callAnthropic({
      model,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: TOOL_DEFS,
      messages,
    })

    usage.input_tokens += res.usage.input_tokens
    usage.output_tokens += res.usage.output_tokens
    usage.cache_read_tokens += res.usage.cache_read_input_tokens ?? 0

    messages.push({ role: 'assistant', content: res.content })

    if (res.stop_reason === 'tool_use') {
      const toolUses = res.content.filter((b) => b.type === 'tool_use')
      const toolResults: AnthropicContentBlock[] = []
      for (const tu of toolUses) {
        // Structured-output tool — capture the input as a UI side-effect
        // and short-circuit execution with a success ack for Claude.
        if (tu.name === 'prepare_invoice_creation') {
          const invoice = invoiceFromToolInput(tu.input ?? {})
          pendingActions.push({
            type: 'open_prefill_form',
            invoice,
            supplier_name: (tu.input as { supplier_name?: string })?.supplier_name,
          })
          toolCalls.push({ name: tu.name, input: tu.input ?? {}, result: { status: 'queued_for_user_review' } })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id ?? '',
            content: JSON.stringify({
              status: 'queued_for_user_review',
              message: 'Prefill form is now opening. The user will review and submit.',
              lines_count: invoice.lines.length,
            }),
          })
          continue
        }

        const result = await executeTool(tu.name ?? '', tu.input ?? {})
        toolCalls.push({ name: tu.name ?? '', input: tu.input ?? {}, result })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id ?? '',
          content: JSON.stringify(result),
        })
      }
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    finalText = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim()
    break
  }

  if (!finalText) {
    finalText = pendingActions.length
      ? 'Ανοίγω τη φόρμα για επισκόπηση…'
      : '(δεν παράχθηκε απάντηση — πιθανόν εξαντλήθηκε το όριο εργαλείων)'
  }

  return {
    assistant_text: finalText,
    tool_calls: toolCalls,
    usage,
    history: messages,
    pending_actions: pendingActions,
  }
}

/** Normalize the tool's structured input into our ScrapedInvoice shape. */
function invoiceFromToolInput(input: Record<string, unknown>): ScrapedInvoice {
  const linesInput = Array.isArray(input.lines) ? (input.lines as Array<Record<string, unknown>>) : []
  const totals = (input.totals as Record<string, unknown> | undefined) ?? {}
  return {
    supplier_vat: String(input.supplier_vat ?? '').replace(/\s+/g, ''),
    document_type: str(input.document_type),
    series: str(input.series),
    number: str(input.number),
    date: str(input.date),
    mark: str(input.mark),
    uid: str(input.uid),
    lines: linesInput
      .map((l) => ({
        supplier_code: str(l.supplier_code),
        description: String(l.description ?? '').trim(),
        unit_label: str(l.unit_label),
        quantity: toNum(l.quantity) ?? 0,
        unit_price: toNum(l.unit_price) ?? 0,
        line_net: toNum(l.line_net),
        vat_percent: toNum(l.vat_percent),
        line_total: toNum(l.line_total),
      }))
      .filter((l) => l.description),
    totals: {
      net: toNum(totals.net),
      vat: toNum(totals.vat),
      gross: toNum(totals.gross),
    },
  }
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s || undefined
}

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await callAnthropic({
      model: (await getSettings()).anthropic_model || 'claude-sonnet-4-6',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    })
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
    return { ok: true, message: text.trim() || 'OK' }
  } catch (err) {
    return { ok: false, message: String((err as Error)?.message ?? err) }
  }
}
