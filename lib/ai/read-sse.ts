export type SseEvent = {
  delta?: { text?: string; reasoning?: string }
  corpus?: string
}

export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (ev: SseEvent) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let rest = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      rest += decoder.decode(value, { stream: true })
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return
        try {
          onEvent(JSON.parse(data) as SseEvent)
        } catch {
          /* skip */
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
