import { hemingSystem } from '@/lib/ai/grounding'
import { resolveAi, streamChat } from '@/lib/ai/provider'
import type { ZiweiChart } from '@/lib/ziwei/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { chartA?: ZiweiChart; chartB?: ZiweiChart; question?: string; corpus?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.chartA?.birthInfo || !body.chartB?.birthInfo) {
    return Response.json({ error: 'chartA and chartB required' }, { status: 400 })
  }
  const chartA = body.chartA
  const chartB = body.chartB
  const question = typeof body.question === 'string' ? body.question.trim() : ''
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
        const corpus = typeof body.corpus === 'string' ? body.corpus.trim().slice(0, 20000) : ''
        const user = question || '请分析两人的缘分、感情走向、相处矛盾和可行建议。按【缘分总判】【夫妻与福德】【矛盾与互补】【建议】四节写。'
        const system = hemingSystem(chartA, chartB) + (corpus
          ? '\n这一轮用户在追问成稿原文里的某一句。可以解释他点到的句子，不要把原文整篇再说一遍。和盘面不一致时以盘面为准，并说明差别。'
          : '')
        const asked = corpus ? `${user}\n\n成稿原文：\n${corpus}` : user
        await streamChat(ai, [
          { role: 'system', content: system },
          { role: 'user', content: asked },
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
