import { renderCorpus, SOURCE } from '@/lib/interp/dataset'
import type { TopicKey } from '@/lib/ziwei/db-analysis'
import type { ZiweiChart } from '@/lib/ziwei/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Item = { chart?: ZiweiChart; topics?: TopicKey[]; who?: string }

export async function POST(req: Request) {
  let body: { items?: Item[] }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return Response.json({ error: 'items required' }, { status: 400 })
  }
  const parts = body.items.slice(0, 6).map(item => {
    if (!item.chart?.birthInfo || !Array.isArray(item.topics)) return ''
    return renderCorpus(item.chart, item.topics.slice(0, 4), item.who, false)
  })
  return Response.json({ text: [...parts.filter(Boolean), SOURCE].join('\n\n') })
}
