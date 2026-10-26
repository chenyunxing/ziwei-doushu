'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ZiweiChart, Palace } from '@/lib/ziwei/types';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import { topicForPalace } from '@/lib/interp/topics';
import { readSse } from '@/lib/ai/read-sse';
import type { TimeView } from './TimeNav';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  hidden?: boolean;
  kind?: 'ask' | 'detail';
}

interface SelectedSiHua {
  starName: string;
  siHua: string;
  view: TimeView;
}

interface InsightPanelProps {
  chart: ZiweiChart;
  selectedPalace?: Palace | null;
  selectedSiHua?: SelectedSiHua | null;
}

const TOPICS = [
  { key: 'overview',     label: '命格' },
  { key: 'love',        label: '感情' },
  { key: 'career',      label: '事业' },
  { key: 'wealth',      label: '财运' },
  { key: 'health',      label: '健康' },
  { key: 'personality', label: '性格' },
] as const;

const TOPIC_PROMPTS: Record<string, string> = {
  overview: `请生成命格总览，按以下结构输出：

**【命格定性】**
用一句话概括这个命盘的核心格局与命主气质。

**【主星解读】**
命宫主星的核心特质，引用倪海厦原话或观点。

**【三方四正】**
财、官、迁三宫的联动分析及整体格局。

**【当前大限】**
当下大限运势方向与最值得关注的事项。

**【优势与注意】**
命盘天赋优势，以及需要注意的风险或功课。`,

  love: `请深度分析感情婚姻运，按以下结构输出：

**【感情格局】**
一句话定性感情命格。

**【夫妻宫分析】**
夫妻宫主星、四化，以及倪海厦体系的具体解读。

**【三方联动】**
相关宫位对感情的影响。

**【当前大限感情运】**
当下10年感情走向与关键节点。

**【实际建议】**
具体可行的感情建议。`,

  career: `请深度分析事业运，按以下结构输出：

**【事业格局】**
一句话定性事业命格，宜任职或宜创业。

**【官禄宫分析】**
官禄宫主星、四化，以及倪师对这种配置的判断。

**【财帛宫联动】**
财运与事业的关系，财路来源分析。

**【当前大限事业运】**
当下10年事业走向。

**【实际建议】**
适合的方向、行业与策略。`,

  wealth: `请深度分析财运，按以下结构输出：

**【财运格局】**
一句话定性财运模式，是主动财还是被动财。

**【财帛宫分析】**
财帛宫主星、四化，财富来源与流动模式。

**【田宅宫（财库）】**
积蓄能力与不动产运势分析。

**【当前大限财运】**
当下财运走向与注意事项。

**【理财建议】**
具体的财务建议。`,

  health: `请分析健康运势，按以下结构输出：

**【疾厄宫主星】**
疾厄宫星曜与健康含义。

**【主要风险】**
结合倪海厦子午流注理论，分析主要健康隐患与需关注的部位。

**【大限健康走势】**
当下健康趋势与关键时间段。

**【预防建议】**
具体注意事项与养生方向。`,

  personality: `请深度解析性格特质，按以下结构输出：

**【命宫主星性格】**
命宫主星的核心性格特质，引用倪师原话。

**【三方性格综合】**
财、官、迁三宫对性格的影响，全貌描绘。

**【人际关系模式】**
与他人互动方式、待人处世风格。

**【优势与人生课题】**
天赋优势，以及需要面对的人生功课。`,
};

const PALACE_ROLES: Record<string, string> = {
  '命宫':   '自我、性格、先天格局',
  '兄弟宫': '兄弟关系、合伙人',
  '夫妻宫': '感情关系、婚姻状态',
  '子女宫': '子女缘分、下属关系',
  '财帛宫': '财运来源、收入方式',
  '疾厄宫': '身体健康、意外',
  '迁移宫': '外出机遇、人际格局',
  '交友宫': '朋友圈、贵人、小人',
  '官禄宫': '事业成就、社会地位',
  '田宅宫': '不动产、家庭环境',
  '福德宫': '精神享受、内心福分',
  '父母宫': '父母关系、文书契约',
};

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: 'var(--t-card)', border: '1px solid var(--t-border)' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-[14px] w-full text-left"
        style={{ color: 'var(--t-faint)' }}
      >
        {open ? '收起思考过程' : '展开思考过程'}
        {streaming ? ' · 思考中' : ''}
      </button>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto">
          <AiContent text={text} streaming={streaming} muted />
        </div>
      )}
    </div>
  );
}

/** Render AI markdown: **【Title】** → gold header, **bold** → strong */
function AiContent({ text, streaming, muted }: { text: string; streaming?: boolean; muted?: boolean }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const sectionMatch = line.match(/^\*\*【(.+?)】\*\*$/);
        if (sectionMatch) {
          return (
            <div key={i} className="pt-3 pb-0.5 first:pt-0">
              <span className="text-[16px] font-semibold tracking-wide" style={{ color: muted ? 'var(--t-faint)' : 'var(--t-gold)' }}>
                【{sectionMatch[1]}】
              </span>
            </div>
          );
        }
        if (line.trim() === '') return <div key={i} className="h-1.5" />;
        const parts = line.split(/\*\*(.+?)\*\*/);
        return (
          <div key={i} className="text-[15px] leading-relaxed" style={{ color: muted ? 'var(--t-faint)' : 'var(--t-text2)' }}>
            {parts.map((part, j) =>
              j % 2 === 0
                ? part
                : <strong key={j} className="font-medium" style={{ color: muted ? 'var(--t-text2)' : 'var(--t-text)' }}>{part}</strong>
            )}
          </div>
        );
      })}
      {streaming && (
        <span
          className="inline-block w-1.5 h-3 ml-0.5 animate-pulse rounded-sm align-middle"
          style={{ background: 'var(--t-gold)', opacity: 0.6 }}
        />
      )}
    </div>
  );
}

async function fetchCorpus(items: { chart: ZiweiChart; topics: TopicKey[]; who?: string }[]): Promise<string> {
  const res = await fetch('/api/corpus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error('corpus');
  const data = await res.json() as { text?: string };
  return data.text ?? '';
}

export default function InsightPanel({ chart, selectedPalace, selectedSiHua }: InsightPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [corpus, setCorpus] = useState('');
  const [corpusLoading, setCorpusLoading] = useState(false);
  const [tab, setTab] = useState<'corpus' | 'ai'>('corpus');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTopic, setActiveTopic] = useState<string>('overview');
  const messagesRef = useRef<Message[]>([]);
  const loadingRef = useRef(false);
  const focusPrompt = useRef<string | null>(null);
  const lastPalaceBranch = useRef<number | undefined>(undefined);
  const lastSiHuaKey = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const loadCorpus = async (topics: TopicKey[]) => {
    setCorpusLoading(true);
    try {
      setCorpus(await fetchCorpus([{ chart, topics }]));
    } catch {
      setCorpus('成稿读取失败。');
    } finally {
      setCorpusLoading(false);
    }
  };

  useEffect(() => {
    setActiveTopic('overview');
    setMessages([]);
    focusPrompt.current = null;
    lastPalaceBranch.current = undefined;
    lastSiHuaKey.current = undefined;
    void loadCorpus(['overview']);
  }, [chart]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedPalace || selectedPalace.branch === lastPalaceBranch.current) return;
    lastPalaceBranch.current = selectedPalace.branch;
    const topic = topicForPalace(selectedPalace.name);
    setActiveTopic(topic);
    setMessages([]);
    const majorStars = selectedPalace.stars.filter(s => s.type === 'major');
    const starDesc = majorStars.length > 0
      ? majorStars.map(s => `${s.name}${s.siHua ? '化' + s.siHua : ''}`).join('、')
      : '空宫（借对宫）';
    const role = PALACE_ROLES[selectedPalace.name] ?? PALACE_ROLES[`${selectedPalace.name.replace(/宫$/, '')}宫`] ?? '';
    focusPrompt.current = `请重点分析【${selectedPalace.name}】（主管：${role}），该宫主星为${starDesc}，按以下结构输出：

**【宫位定性】**
${selectedPalace.name}在命盘中的意义，以及这种星曜配置的整体判断。

**【主星解读】**
主星在此宫的倪海厦体系解读，引用具体观点。

**【三方四正联动】**
三方四正宫位对此宫的影响。

**【实际建议】**
基于此宫的具体建议。`;
    void loadCorpus([topic]);
  }, [selectedPalace]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedSiHua) return;
    const key = `${selectedSiHua.starName}-${selectedSiHua.siHua}-${selectedSiHua.view}`;
    if (key === lastSiHuaKey.current) return;
    lastSiHuaKey.current = key;
    const palaceOfStar = chart.palaces.find(p => p.stars.some(s => s.name === selectedSiHua.starName));
    const palaceName = palaceOfStar?.name ?? '未知宫位';
    const viewLabel = selectedSiHua.view === 'daxian' ? '大限' : '流年';
    if (palaceOfStar) {
      const topic = topicForPalace(palaceOfStar.name);
      setActiveTopic(topic);
      setMessages([]);
      void loadCorpus([topic]);
    }
    focusPrompt.current = `请分析【${viewLabel}${selectedSiHua.starName}化${selectedSiHua.siHua}】的飞化影响，按以下结构输出：

**【化${selectedSiHua.siHua}基本含义】**
化${selectedSiHua.siHua}在倪海厦体系中的核心含义，以及${selectedSiHua.starName}化${selectedSiHua.siHua}的特殊含义。

**【落宫影响】**
${selectedSiHua.starName}化${selectedSiHua.siHua}落在【${palaceName}】，该宫主管的领域受到何种影响，倪师如何解读。

**【三方四正飞化路径】**
化${selectedSiHua.siHua}入${palaceName}后，对其三方四正（对宫、两个三合宫）的联动影响。

**【当前运势影响】**
在${viewLabel}时间维度下，此化${selectedSiHua.siHua}对命主近期运势的具体影响。

**【实际建议】**
基于此四化的具体可操作建议。`;
    setTab('ai');
  }, [selectedSiHua]); // eslint-disable-line react-hooks/exhaustive-deps

  const streamResponse = async (
    apiMessages: { role: 'user' | 'assistant'; content: string }[],
    corpusForAsk?: string,
  ) => {
    const kind: 'ask' | 'detail' = corpusForAsk ? 'ask' : 'detail';
    try {
      const res = await fetch('/api/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart, messages: apiMessages, corpus: corpusForAsk }),
      });
      if (res.status === 404) throw new Error('api-missing');
      if (!res.ok) throw new Error('请求失败');
      if (!res.body) throw new Error('无响应流');

      setMessages(prev => [...prev, { role: 'assistant', content: '', reasoning: '', kind }]);
      await readSse(res.body, (ev) => {
        const text = ev.delta?.text ?? '';
        const reasoning = ev.delta?.reasoning ?? '';
        if (!text && !reasoning) return;
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (!last || last.role !== 'assistant') return updated;
          updated[updated.length - 1] = {
            ...last,
            content: text ? last.content + text : last.content,
            reasoning: reasoning ? `${last.reasoning ?? ''}${reasoning}` : last.reasoning,
          };
          return updated;
        });
      });
    } catch (e) {
      const missing = e instanceof Error && e.message === 'api-missing';
      setMessages(prev => [...prev, { role: 'assistant', content: missing ? '开源版不含 AI 解读接口（/api/interpret），需要你自己实现后才能用，详见 README「快速开始」。排盘本身不需要任何 API Key。' : '解读失败，请稍后重试。' }]);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const sendMessage = (text: string, hidden = false, corpusForAsk?: string) => {
    if (!text.trim() || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    const userMsg: Message = { role: 'user', content: text, hidden, kind: corpusForAsk ? 'ask' : 'detail' };
    // Capture current messages synchronously via ref (avoids stale closure)
    const apiMessages = [...messagesRef.current, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }));

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    streamResponse(apiMessages, corpusForAsk);
  };

  const handleTopicClick = (topicKey: string) => {
    focusPrompt.current = null;
    setActiveTopic(topicKey);
    setMessages([]);
    void loadCorpus([topicKey as TopicKey]);
  };

  const runDetailed = () => {
    if (loadingRef.current) return;
    setTab('ai');
    sendMessage(focusPrompt.current || TOPIC_PROMPTS[activeTopic] || TOPIC_PROMPTS.overview, true);
  };

  const handleSend = () => {
    if (!input.trim()) return;
    setTab('ai');
    sendMessage(input, false, corpus);
  };

  return (
    <div className="flex flex-col h-full rounded-xl overflow-hidden card-glass">

      {/* ── Topic buttons ── */}
      <div className="flex-shrink-0 px-2 pt-2.5 pb-2" style={{ borderBottom: '1px solid var(--t-border)' }}>
        <div className="grid grid-cols-6 gap-1">
          {TOPICS.map(t => {
            const isActive = activeTopic === t.key;
            return (
              <button
                key={t.key}
                onClick={() => handleTopicClick(t.key)}
                disabled={loading}
                className="py-2 text-[14px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
                style={{
                  background: isActive ? 'rgba(212,168,67,0.12)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(212,168,67,0.3)' : 'var(--t-border)'}`,
                  color: isActive ? 'var(--t-gold)' : 'var(--t-faint)',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 flex gap-1 px-2 py-2" style={{ borderBottom: '1px solid var(--t-border)' }}>
        {([['corpus', '成稿'], ['ai', 'AI推演']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="flex-1 py-2.5 text-[15px] rounded-lg"
            style={{
              background: tab === id ? 'rgba(212,168,67,0.14)' : 'transparent',
              border: `1px solid ${tab === id ? 'rgba(212,168,67,0.35)' : 'var(--t-border)'}`,
              color: tab === id ? 'var(--t-gold)' : 'var(--t-faint)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'corpus' ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0" style={{ maxHeight: '70vh' }}>
          {corpusLoading && !corpus ? (
            <p className="text-[15px] animate-pulse" style={{ color: 'var(--t-faint)' }}>正在读取这一年的成稿…</p>
          ) : (
            <AiContent text={corpus || '这一维还没有成稿。'} />
          )}
        </div>
      ) : (
        <>
          <div className="flex-shrink-0 overflow-y-auto px-4 py-3" style={{ maxHeight: 280, borderBottom: '1px solid var(--t-border)' }}>
            <div className="text-[13px] tracking-widest mb-2" style={{ color: 'var(--t-faint)' }}>原文</div>
            {corpusLoading && !corpus ? (
              <p className="text-[15px]" style={{ color: 'var(--t-faint)' }}>正在读取原文…</p>
            ) : (
              <AiContent text={corpus || '原文还没有。'} />
            )}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 && !loading && (
              <p className="text-[15px] leading-relaxed" style={{ color: 'var(--t-faint)' }}>
                上面是这一维的原文。可以追问其中某一句，或做细致推演。
              </p>
            )}
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => {
                if (msg.role === 'user' && msg.hidden) return null;
                if (msg.role === 'user') {
                  return (
                    <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                      <div
                        className="max-w-[85%] rounded-xl px-3 py-2 text-[15px]"
                        style={{
                          background: 'rgba(212,168,67,0.08)',
                          border: '1px solid rgba(212,168,67,0.18)',
                          color: 'var(--t-gold)',
                        }}
                      >
                        {msg.content}
                      </div>
                    </motion.div>
                  );
                }
                const isLastMsg = i === messages.length - 1;
                const title = msg.kind === 'ask' ? '追问' : '细致推演';
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                    <ThinkingBlock text={msg.reasoning ?? ''} streaming={loading && isLastMsg && !msg.content} />
                    <div className="rounded-xl px-3 py-3" style={{ background: 'rgba(212,168,67,0.06)', border: '1px solid rgba(212,168,67,0.2)' }}>
                      <div className="text-[13px] tracking-widest mb-2" style={{ color: 'var(--t-gold)' }}>{title}</div>
                      {msg.content ? (
                        <AiContent text={msg.content} streaming={loading && isLastMsg} />
                      ) : (
                        <p className="text-[15px]" style={{ color: 'var(--t-faint)' }}>
                          {loading && isLastMsg ? '正在整理这一段…' : '这一段没有正文。'}
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          <div className="flex-shrink-0 px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--t-border)' }}>
            <button
              type="button"
              onClick={runDetailed}
              disabled={loading}
              className="w-full mb-2 py-2.5 text-[15px] rounded-lg disabled:opacity-40"
              style={{
                background: 'rgba(212,168,67,0.15)',
                border: '1px solid rgba(212,168,67,0.25)',
                color: 'var(--t-gold)',
              }}
            >
              {loading ? '推演中…' : '细致推演'}
            </button>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="追问原文里的细节"
                disabled={loading}
                className="flex-1 rounded-lg px-3 py-2.5 text-[15px] focus:outline-none transition-colors"
                style={{
                  background: 'var(--t-card)',
                  border: '1px solid var(--t-border)',
                  color: 'var(--t-text)',
                }}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="px-4 py-2.5 rounded-lg text-[15px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: 'rgba(212,168,67,0.15)',
                  border: '1px solid rgba(212,168,67,0.25)',
                  color: 'var(--t-gold)',
                }}
              >
                {loading ? '…' : '追问'}
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
