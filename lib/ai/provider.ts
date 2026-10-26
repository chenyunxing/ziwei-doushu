export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatDelta = { text?: string; reasoning?: string }

export type AiConfig = { baseUrl: string; apiKey: string; model: string }

function usable(value: string | undefined): value is string {
  return !!value && !value.includes('your-')
}

export function resolveAi(): AiConfig | null {
  const provider = (process.env.AI_PROVIDER || 'deepseek').toLowerCase()
  if (provider === 'mimo') {
    if (!usable(process.env.MIMO_API_KEY) || !usable(process.env.MIMO_BASE_URL) || !process.env.MIMO_MODEL) return null
    return {
      apiKey: process.env.MIMO_API_KEY,
      baseUrl: process.env.MIMO_BASE_URL.replace(/\/$/, ''),
      model: process.env.MIMO_MODEL,
    }
  }
  if (!usable(process.env.DEEPSEEK_API_KEY)) return null
  return {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  }
}

export async function streamChat(
  cfg: AiConfig,
  messages: LlmMessage[],
  onDelta: (delta: ChatDelta) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      temperature: 0.4,
      max_tokens: 8000,
      messages,
    }),
  })
  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => '')
    throw new Error(`模型接口 ${res.status}：${err.slice(0, 200)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let rest = ''
  let saw = false
  const take = (chunk: string) => {
    const lines = chunk.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return true
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: unknown; reasoning_content?: unknown } }[]
        }
        const delta = json.choices?.[0]?.delta
        const text = textOf(delta?.content)
        const reasoning = textOf(delta?.reasoning_content)
        if (reasoning) {
          saw = true
          onDelta({ reasoning })
        }
        if (text) {
          saw = true
          onDelta({ text })
        }
      } catch {
        /* skip */
      }
    }
    return false
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      rest += decoder.decode(value, { stream: true })
      if (take(rest)) break
    }
    if (rest.trim()) take(`${rest}\n`)
    if (!saw) throw new Error('模型没有返回正文')
  } finally {
    reader.releaseLock()
  }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(part => {
    if (typeof part === 'string') return part
    if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
      return (part as { text: string }).text
    }
    return ''
  }).join('')
}
