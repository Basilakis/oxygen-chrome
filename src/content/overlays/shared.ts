export function mountShadowHost(id: string, z = 2147483000): { host: HTMLDivElement; root: ShadowRoot } {
  let host = document.getElementById(id) as HTMLDivElement | null
  if (host) {
    const existing = host.shadowRoot
    if (existing) return { host, root: existing }
  }
  host = document.createElement('div')
  host.id = id
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    zIndex: String(z),
  } as CSSStyleDeclaration)
  document.documentElement.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  return { host, root }
}

export function unmountHost(id: string): void {
  const el = document.getElementById(id)
  if (el) el.remove()
}

export function injectStyles(root: ShadowRoot, css: string): void {
  const style = document.createElement('style')
  style.textContent = css
  root.appendChild(style)
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; style?: Partial<CSSStyleDeclaration> } = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  const { class: cls, style, ...rest } = props as {
    class?: string
    style?: Partial<CSSStyleDeclaration>
  } & Partial<HTMLElementTagNameMap[K]>
  if (cls) el.className = cls
  if (style) Object.assign(el.style, style)
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else {
      try {
        ;(el as unknown as Record<string, unknown>)[k] = v
      } catch {
        /* readonly props, ignore */
      }
    }
  }
  for (const c of children) {
    if (typeof c === 'string') el.appendChild(document.createTextNode(c))
    else el.appendChild(c)
  }
  return el
}
