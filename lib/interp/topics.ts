import type { TopicKey } from '../ziwei/db-analysis'

const PALACE_TOPIC: Record<string, TopicKey[]> = {
  命: ['overview', 'personality'],
  兄弟: ['family'],
  夫妻: ['love'],
  子女: ['children'],
  财帛: ['wealth'],
  疾厄: ['health'],
  迁移: ['move'],
  仆役: ['friends'],
  交友: ['friends'],
  官禄: ['career'],
  田宅: ['home'],
  福德: ['spirit'],
  父母: ['parents'],
}

export function topicForPalace(name: string): TopicKey {
  const base = name.replace(/宫$/, '')
  if (base === '命') return 'overview'
  return PALACE_TOPIC[base]?.[0] ?? 'overview'
}

function topicsForPalace(name: string): TopicKey[] {
  const base = name.replace(/宫$/, '')
  return PALACE_TOPIC[base] ?? []
}

function add(found: TopicKey[], key: TopicKey) {
  if (!found.includes(key)) found.push(key)
}

export function topicsFromUserText(text: string): TopicKey[] {
  const found: TopicKey[] = []
  for (const match of text.matchAll(/【(.+?)】/g)) {
    const name = match[1]
    if (/[禄权科忌]/.test(name) && !/宫/.test(name)) continue
    for (const key of topicsForPalace(name)) add(found, key)
  }
  if (text.includes('命格总览') || text.includes('整体命格')) add(found, 'overview')
  if (text.includes('性格特质') || text.includes('性格特点')) add(found, 'personality')
  if (text.includes('感情婚姻') || text.includes('感情运势') || text.includes('感情匹配')) add(found, 'love')
  if (text.includes('事业运') || text.includes('事业财运') || text.includes('合伙')) add(found, 'career')
  if (text.includes('分析财运') || text.includes('财运如何') || text.includes('事业财运') || text.includes('财运是否')) add(found, 'wealth')
  if (text.includes('健康')) add(found, 'health')
  if (found.length === 0 && (text.includes('大限运势') || text.includes('流年运势'))) add(found, 'overview')
  return found.slice(0, 4)
}

export function hemingTopics(question?: string): TopicKey[] {
  const q = question ?? ''
  const topics: TopicKey[] = ['love']
  if (/合伙|事业|创业/.test(q)) topics.push('career')
  if (/财/.test(q)) topics.push('wealth')
  return topics
}
