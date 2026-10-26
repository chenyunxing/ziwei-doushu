import fs from 'fs'
import path from 'path'
import { BRANCHES, STEMS } from '../ziwei/constants'
import type { TopicKey } from '../ziwei/db-analysis'
import { HEMING_METHODOLOGY, MARRIAGE_STARS_BRIEF, SIHUA_IN_FUQI_GU, STAR_IN_FUQI_GU } from '../ziwei/heming-knowledge'
import { detectPatterns, type Pattern } from '../ziwei/patterns'
import type { Palace, Star, ZiweiChart } from '../ziwei/types'

const LEVEL: Record<Pattern['level'], string> = {
  excellent: '上格',
  good: '吉',
  neutral: '平',
  caution: '慎',
}

const TOPIC_PALACES: Record<TopicKey, string[]> = {
  overview: ['命宫', '财帛', '官禄', '迁移'],
  personality: ['命宫', '福德', '仆役'],
  love: ['夫妻', '福德', '命宫'],
  career: ['官禄', '命宫', '迁移'],
  wealth: ['财帛', '田宅', '福德'],
  health: ['疾厄', '命宫', '父母'],
  family: ['兄弟', '命宫'],
  children: ['子女', '夫妻'],
  move: ['迁移', '命宫'],
  friends: ['仆役', '兄弟'],
  home: ['田宅', '福德', '父母'],
  spirit: ['福德', '命宫'],
  parents: ['父母', '命宫', '疾厄'],
}

type Quote = { h2: string; h3: string; quote: string; t_hms: string }

let quotes: Quote[] | null = null

function loadQuotes(): Quote[] {
  if (quotes) return quotes
  const file = path.join(process.cwd(), 'docs', 'tianji-ziwei', 'entries.jsonl')
  const raw = fs.readFileSync(file, 'utf8')
  quotes = raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as Quote)
  return quotes
}

function findPalace(chart: ZiweiChart, short: string): Palace | undefined {
  return chart.palaces.find(p => p.name === short || p.name === `${short}宫` || p.name.replace(/宫$/, '') === short)
}

function fmtStar(star: Star): string {
  return `${star.name}${star.brightnessRaw ?? ''}${star.siHua ? `化${star.siHua}` : ''}`
}

function majorNames(palace: Palace | undefined): string[] {
  if (!palace) return []
  const majors = palace.stars.filter(s => s.type === 'major').map(s => s.name)
  if (majors.length > 0) return majors
  return palace.borrowedStars ?? []
}

export function briefChart(chart: ZiweiChart): string {
  const b = chart.birthInfo
  const lunar = chart.lunarInfo
  const shi = BRANCHES[b.hour] ?? String(b.hour)
  const lines: string[] = [
    `性别 ${b.gender === 'female' ? '女' : '男'}${chart.yinYangGender ? `（${chart.yinYangGender}）` : ''}，${chart.wuxingJuName}，命主 ${chart.mingZhu ?? '未知'}，身主 ${chart.shenZhu ?? '未知'}`,
    `排盘公历 ${b.year}年${b.month}月${b.day}日${shi}时${b.longitude != null ? `，出生地经度 ${b.longitude}` : ''}`,
    `农历 ${lunar.lunarYear}年${lunar.isLeapMonth ? '闰' : ''}${Math.abs(lunar.lunarMonth)}月${lunar.lunarDay}日`,
  ]
  if (lunar.fourPillars) lines.push(`四柱 ${lunar.fourPillars.join(' ')}`)
  const dx = chart.daXians?.[chart.currentDaXianIndex]
  if (dx) {
    const hua = dx.siHua ? `，大限四化 禄${dx.siHua.lu} 权${dx.siHua.quan} 科${dx.siHua.ke} 忌${dx.siHua.ji}` : ''
    lines.push(`当前虚岁 ${chart.currentAge}，大限 ${dx.startAge}-${dx.endAge}岁在${dx.palaceName}（${dx.stemName ?? ''}${BRANCHES[dx.palaceBranch] ?? ''}）${hua}`)
  }
  lines.push('十二宫（亮度以这张盘为准）：')
  for (const palace of chart.palaces) {
    const stem = STEMS[palace.stem] ?? ''
    const branch = BRANCHES[palace.branch] ?? ''
    const tags = [
      palace.isMingGong ? '命' : '',
      palace.isShenGong ? '身' : '',
      palace.isCurrentDaXian ? '当前大限' : '',
    ].filter(Boolean)
    const majors = palace.stars.filter(s => s.type === 'major').map(fmtStar)
    const rest = palace.stars.filter(s => s.type !== 'major').map(fmtStar)
    const self = palace.selfSihua?.map(s => `${s.starName}化${s.siHua}`).join('、')
    const empty = palace.isEmpty ? `空宫借${palace.borrowedFromName ?? '对宫'}${(palace.borrowedStars ?? []).join('、')}` : ''
    lines.push([
      `${palace.name}${stem}${branch}`,
      tags.length ? `[${tags.join('/')}]` : '',
      majors.length ? `主${majors.join('、')}` : empty,
      rest.length ? `杂${rest.join('、')}` : '',
      self ? `自化${self}` : '',
    ].filter(Boolean).join(' '))
  }
  let patterns: Pattern[] = []
  try {
    patterns = detectPatterns(chart)
  } catch {
    patterns = []
  }
  if (patterns.length > 0) {
    lines.push('格局：')
    for (const pattern of patterns.slice(0, 12)) {
      lines.push(`- ${pattern.name}（${LEVEL[pattern.level]}）${pattern.description}`)
    }
  }
  return lines.join('\n')
}

function focusStars(chart: ZiweiChart, topics: TopicKey[]): string[] {
  const palaces = topics.length > 0
    ? topics.flatMap(topic => TOPIC_PALACES[topic])
    : ['命宫', '夫妻', '官禄', '财帛']
  const names = palaces.flatMap(name => majorNames(findPalace(chart, name.replace(/宫$/, ''))))
  return [...new Set(names)].slice(0, 8)
}

export function quotesForStars(stars: string[]): string {
  if (stars.length === 0) return '（这几宫没有主星，下面没有对应原话）'
  let entries: Quote[]
  try {
    entries = loadQuotes()
  } catch {
    return '（天纪原话文件没读到）'
  }
  const hits: { entry: Quote; n: number }[] = []
  for (const entry of entries) {
    const blob = `${entry.h2}\n${entry.h3}\n${entry.quote}`
    const n = stars.filter(star => blob.includes(star)).length
    if (n === 0) continue
    if (entry.quote.length < 8 || entry.quote.length > 180) continue
    hits.push({ entry, n })
  }
  hits.sort((a, b) => b.n - a.n || a.entry.quote.length - b.entry.quote.length)
  const top = hits.slice(0, 8)
  if (top.length === 0) return '（语料里没有同时提到这些主星的短句）'
  return top.map(hit => `- ${hit.entry.h2} / ${hit.entry.h3}（${hit.entry.t_hms}）：${hit.entry.quote}`).join('\n')
}

const SHARED_RULES = [
  '格局说明可以转述。写成倪师原话并带时间码的，只能来自「可引用原话」。没有列出来的句子，不要编成原话或古籍引文。',
  '用中文。用户要求的小节标题各自单独一行，格式是：**【标题】**。',
].join('\n')

export function interpretSystem(chart: ZiweiChart, topics: TopicKey[], corpus?: string): string {
  const stars = focusStars(chart, topics)
  const source = corpus?.trim()
    ? [
        '这一轮用户在追问成稿原文里的细节。只解释他问到的句子，不要把全文再抄一遍。',
        '成稿亮度是现代修正 v2。和下面盘面不一致时，以盘面为准，并说明差别。',
        '',
        '成稿原文：',
        corpus.trim().slice(0, 20000),
      ].join('\n')
    : [
        '只根据下面给出的盘面、格局和原话来写。屏幕上会另显示 v4.0 成稿，不要复述成稿，也不要说自己看过成稿。',
        '成稿的亮度是现代修正 v2，这张盘的亮度以下面列出的档为准。两边不一致时，按这张盘写。',
      ].join('\n')
  return [source, SHARED_RULES, '', briefChart(chart), '', '可引用原话：', quotesForStars(stars)].join('\n')
}

function fuqiBlock(chart: ZiweiChart): string {
  const palace = findPalace(chart, '夫妻')
  if (!palace) return '夫妻宫缺失'
  const majors = palace.stars.filter(s => s.type === 'major')
  const names = majors.length > 0 ? majors.map(s => s.name) : (palace.borrowedStars ?? [])
  const lines: string[] = []
  if (majors.length === 0) lines.push(`夫妻宫无主星，借星：${names.join('、') || '无'}`)
  for (const name of names) {
    const row = STAR_IN_FUQI_GU[name]
    if (!row) continue
    lines.push(`${name}在夫妻：${row.summary}。吉：${row.good}。凶：${row.bad}。配偶：${row.spouse_traits}。婚期：${row.timing}${row.ni_quote ? `。原话：${row.ni_quote}` : ''}`)
  }
  const sihuaTable = SIHUA_IN_FUQI_GU as Record<string, string>
  for (const star of palace.stars) {
    if (!star.siHua) continue
    const text = sihuaTable[`化${star.siHua}`]
    if (text) lines.push(`${star.name}化${star.siHua}：${text}`)
  }
  const aux = new Set(palace.stars.map(s => s.name))
  const ming = findPalace(chart, '命宫')
  if (ming) for (const star of ming.stars) aux.add(star.name)
  for (const [name, text] of Object.entries(MARRIAGE_STARS_BRIEF)) {
    if (aux.has(name)) lines.push(`${name}：${text}`)
  }
  return lines.join('\n') || '夫妻宫没有对上知识库里的主星条目'
}

export function hemingSystem(chartA: ZiweiChart, chartB: ZiweiChart): string {
  return [
    '你在给同一个人看两张盘的合盘。只根据下面的盘面、夫妻宫断语和方法论来写。',
    '屏幕上会另显示双方 v4.0 成稿。不要复述成稿。',
    '写成原话的句子，只能使用下面已经写出来的那些。',
    '用中文。小节标题各自单独一行，格式是：**【标题】**。',
    '',
    '甲方',
    briefChart(chartA),
    fuqiBlock(chartA),
    '',
    '乙方',
    briefChart(chartB),
    fuqiBlock(chartB),
    '',
    HEMING_METHODOLOGY.trim(),
  ].join('\n')
}
