import { interpretSystem } from '@/lib/ai/grounding'
import { resolveAi, streamChat, type LlmMessage } from '@/lib/ai/provider'
import { topicsFromUserText } from '@/lib/interp/topics'
import type { ZiweiChart } from '@/lib/ziwei/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Incoming = { role?: string; content?: string }

function historyOf(messages: Incoming[]): LlmMessage[] {
  return messages
    .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
      (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content }))
}

export async function POST(req: Request) {
  let body: { chart?: ZiweiChart; messages?: Incoming[]; corpus?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.chart?.birthInfo || !Array.isArray(body.messages)) {
    return Response.json({ error: 'chart and messages required' }, { status: 400 })
  }
  const chart = body.chart
  const history = historyOf(body.messages)
  const lastUser = [...history].reverse().find(m => m.role === 'user')
  const topics = lastUser ? topicsFromUserText(lastUser.content) : []
  const abort = new AbortController()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }
      try {
        const ai = resolveAi()
        if (!ai) {
          send({ delta: { text: '细致推演还没开始。.env.local 里要有可用的 API Key（DeepSeek 用 DEEPSEEK_API_KEY）。成稿不依赖 Key。' } })
          return
        }
        const corpus = typeof body.corpus === 'string' ? body.corpus : undefined
        await streamChat(ai, [
          { role: 'system', content: interpretSystem(chart, topics, corpus) },
          ...history,
        ], delta => send({ delta }), abort.signal)
      } catch (e) {
        if (abort.signal.aborted) return
        const msg = e instanceof Error ? e.message : '现写失败'
        try { send({ delta: { text: `\n\n现写失败：${msg}` } }) } catch { /* closed */ }
      } finally {
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch { /* closed */ }
      }
    },
    cancel() { abort.abort() },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
