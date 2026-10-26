import fs from 'fs'
import path from 'path'
import { TOPIC_LABEL, type TopicKey } from '../ziwei/db-analysis'
import type { ZiweiChart } from '../ziwei/types'

const HOUR = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

type KeyParts = { y: number; m: number; d: number; h: number; g: number }

export function interpDataDir(): string {
  return process.env.INTERP_DATA_DIR || path.join(process.cwd(), 'data', 'interp-v4')
}

function yearJsonl(year: number): string {
  return path.join(interpDataDir(), `year-${year}.jsonl`)
}

function parseKey(k: string): KeyParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{1,2})-(male|female)$/.exec(k)
  if (!m) return null
  return {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    g: m[5] === 'female' ? 1 : 0,
  }
}

function cmpKey(a: KeyParts, b: KeyParts): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.m !== b.m) return a.m - b.m
  if (a.d !== b.d) return a.d - b.d
  if (a.h !== b.h) return a.h - b.h
  return a.g - b.g
}

function readForward(fd: number, start: number, size: number): { start: number; end: number; text: string } | null {
  if (start >= size) return null
  const pieces: Buffer[] = []
  let offset = start
  while (offset < size) {
    const len = Math.min(256 * 1024, size - offset)
    const buf = Buffer.alloc(len)
    const n = fs.readSync(fd, buf, 0, len, offset)
    if (n <= 0) break
    const slice = n === len ? buf : buf.subarray(0, n)
    const nl = slice.indexOf(0x0a)
    if (nl >= 0) {
      pieces.push(slice.subarray(0, nl))
      return {
        start,
        end: offset + nl,
        text: Buffer.concat(pieces).toString('utf8').replace(/\r$/, ''),
      }
    }
    pieces.push(Buffer.from(slice))
    offset += n
  }
  if (pieces.length === 0) return null
  return { start, end: offset, text: Buffer.concat(pieces).toString('utf8').replace(/\r$/, '') }
}

function lineContaining(fd: number, pos: number, size: number): { start: number; end: number; text: string } | null {
  if (size <= 0) return null
  if (pos >= size) pos = size - 1
  let start = 0
  if (pos > 0) {
    let cursor = pos
    let found = false
    while (cursor > 0) {
      const back = Math.min(1024 * 1024, cursor)
      const buf = Buffer.alloc(back)
      fs.readSync(fd, buf, 0, back, cursor - back)
      const rel = buf.lastIndexOf(0x0a)
      if (rel >= 0) {
        start = cursor - back + rel + 1
        found = true
        break
      }
      cursor -= back
    }
    if (!found) start = 0
  }
  return readForward(fd, start, size)
}

function findRecord(fd: number, size: number, target: KeyParts): string | null {
  let low = 0
  let high = size
  for (let step = 0; step < 48 && low < high; step++) {
    const mid = Math.floor((low + high) / 2)
    const line = lineContaining(fd, mid, size)
    if (!line) return null
    const raw = /"k":"([^"]+)"/.exec(line.text)?.[1]
    const parts = raw ? parseKey(raw) : null
    if (!parts) return null
    const order = cmpKey(parts, target)
    if (order === 0) return line.text
    if (order < 0) {
      const next = line.end + 1
      if (next <= low) return null
      low = next
    } else {
      if (line.start <= low) return null
      high = line.start
    }
  }
  return null
}

function lookupTopics(year: number, key: string, topics: TopicKey[]): Record<string, string> | null {
  const target = parseKey(key)
  if (!target) return null
  const fd = fs.openSync(yearJsonl(year), 'r')
  try {
    const size = fs.fstatSync(fd).size
    const text = findRecord(fd, size, target)
    if (!text) return null
    const row = JSON.parse(text) as { c?: Record<string, string> }
    const picked: Record<string, string> = {}
    for (const topic of topics) picked[topic] = row.c?.[topic] ? String(row.c[topic]) : ''
    return picked
  } finally {
    fs.closeSync(fd)
  }
}

function candidateKeys(chart: ZiweiChart): string[] {
  const b = chart.birthInfo
  const mm = String(b.month).padStart(2, '0')
  const dd = String(b.day).padStart(2, '0')
  const padded = `${b.year}-${mm}-${dd}-${b.hour}-${b.gender}`
  const raw = `${b.year}-${b.month}-${b.day}-${b.hour}-${b.gender}`
  return padded === raw ? [padded] : [padded, raw]
}

function presentMarkdown(md: string): string {
  return md.split('\n').map(line => {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
    if (heading) return `**【${heading[1].replace(/\*/g, '')}】**`
    const bare = line.match(/^【(.+?)】\s*$/)
    if (bare) return `**【${bare[1]}】**`
    return line
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function caveat(chart: ZiweiChart, key: string): string {
  const b = chart.birthInfo
  const shi = HOUR[b.hour] ?? String(b.hour)
  const where = b.longitude != null ? `，经度 ${b.longitude}（时辰若已按真太阳时校正，成稿对的是校正后的时辰）` : ''
  return `检索键 ${key} · 排盘 ${b.year}年${b.month}月${b.day}日${shi}时${where}。成稿亮度是现代修正 v2，只写本命，不含大限和流年。`
}

export const SOURCE = '来源：紫微斗数开源解读数据集 v4.0 · https://github.com/Renhuai123/ziwei-doushu'

export function renderCorpus(chart: ZiweiChart, topics: TopicKey[], who?: string, attribution = true): string {
  if (topics.length === 0) return ''
  const b = chart.birthInfo
  const titleOf = (topic: TopicKey) => `**【v4.0 成稿 · ${[who, TOPIC_LABEL[topic]].filter(Boolean).join(' · ')}】**`
  if (!Number.isInteger(b.year) || !Number.isInteger(b.hour) || b.hour < 0 || b.hour > 11) {
    return `${titleOf(topics[0])}\n这张盘没有可用于检索的公历日期或时辰序号。`
  }
  if (!fs.existsSync(yearJsonl(b.year))) {
    return `${titleOf(topics[0])}\n没有 ${b.year} 年的成稿文件。目录：${interpDataDir()}`
  }

  const keys = candidateKeys(chart)
  let hitKey = ''
  let row: Record<string, string> | null = null
  try {
    for (const key of keys) {
      const found = lookupTopics(b.year, key, topics)
      if (found) {
        hitKey = key
        row = found
        break
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '读取失败'
    return `${titleOf(topics[0])}\n成稿没读出来：${msg}`
  }
  if (!row) return `${titleOf(topics[0])}\n成稿里没有键 ${keys[0]}。`

  const blocks = topics.map((topic, i) => {
    const body = presentMarkdown(row?.[topic] ?? '').trim()
    const head = titleOf(topic)
    const note = i === 0 ? caveat(chart, hitKey) : ''
    if (!body) return [head, note, '这一维是空的。'].filter(Boolean).join('\n')
    return [head, note, body].filter(Boolean).join('\n\n')
  })
  if (attribution) blocks.push(SOURCE)
  return blocks.join('\n\n')
}
