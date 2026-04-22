export class OxygenApiError extends Error {
  public status: number
  public body: unknown
  public validation?: Record<string, string[]>

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'OxygenApiError'
    this.status = status
    this.body = body
    if (status === 422 && body && typeof body === 'object') {
      const obj = body as Record<string, unknown>
      const errors = obj.errors ?? obj.validation_errors
      if (errors && typeof errors === 'object') {
        this.validation = normalizeValidation(errors as Record<string, unknown>)
      }
    }
  }
}

function normalizeValidation(raw: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) out[k] = v.map(String)
    else if (typeof v === 'string') out[k] = [v]
    else out[k] = [JSON.stringify(v)]
  }
  return out
}

export class OxygenAuthError extends OxygenApiError {
  constructor(body: unknown) {
    super('Authentication failed (401)', 401, body)
    this.name = 'OxygenAuthError'
  }
}
