'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BirthForm, { type BirthFormState } from '@/components/BirthForm';
import { formToBirthInfo } from '@/lib/ziwei/share';
import { generateChart as buildChart } from '@/lib/ziwei/algorithm';
import type { BirthInfo, ZiweiChart } from '@/lib/ziwei/types';
import { readSse } from '@/lib/ai/read-sse';
import { hemingTopics } from '@/lib/interp/topics';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import { useTheme } from '@/components/ThemeProvider';

// ─── AiContent 渲染器（与 InsightPanel 一致）────────────────
function AiContent({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split('\n');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {lines.map((line, i) => {
        const sectionMatch = line.match(/^\*\*【(.+?)】\*\*$/);
        if (sectionMatch) {
          return (
            <div key={i} style={{ paddingTop: i === 0 ? 0 : '14px', paddingBottom: '4px' }}>
              <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ac)', letterSpacing: '0.04em' }}>
                【{sectionMatch[1]}】
              </span>
            </div>
          );
        }
        if (line.trim() === '') return <div key={i} style={{ height: '4px' }} />;
        const parts = line.split(/\*\*(.+?)\*\*/);
        return (
          <div key={i} style={{ fontSize: '16px', lineHeight: 1.75, color: 'var(--tx-2)' }}>
            {parts.map((part, j) =>
              j % 2 === 0
                ? part
                : <strong key={j} style={{ fontWeight: 500, color: 'var(--tx-0)' }}>{part}</strong>
            )}
          </div>
        );
      })}
      {streaming && (
        <span style={{
          display: 'inline-block', width: '7px', height: '13px',
          background: 'var(--ac)', opacity: 0.5, borderRadius: '2px',
          animation: 'pulse 1s ease-in-out infinite',
          verticalAlign: 'middle', marginLeft: '2px',
        }} />
      )}
    </div>
  );
}

export default function HemingPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // ─── 双方命盘状态 ─────────────────────────────────────────
  const [chartA, setChartA] = useState<ZiweiChart | null>(null);
  const [chartB, setChartB] = useState<ZiweiChart | null>(null);
  // 双方表单状态由 BirthForm onFormSave 同步到此处，统一按钮触发起盘
  const [formA, setFormA] = useState<BirthFormState | null>(null);
  const [formB, setFormB] = useState<BirthFormState | null>(null);

  // ─── AI 合盘分析状态 ─────────────────────────────────────
  const [detail, setDetail] = useState<{ reasoning: string; content: string } | null>(null);
  const [asks, setAsks] = useState<{ question: string; reasoning: string; content: string }[]>([]);
  const [openThink, setOpenThink] = useState<Record<string, boolean>>({});
  const [corpus, setCorpus] = useState('');
  const [corpusLoading, setCorpusLoading] = useState(false);
  const [view, setView] = useState<'corpus' | 'ai'>('corpus');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiKind, setAiKind] = useState<'detail' | 'ask'>('detail');
  const [question, setQuestion] = useState('');
  const [analysisError, setAnalysisError] = useState(false);
  // 开源版不含 /api/heming：接口 404 时单独说明，而不是让用户反复重试
  const [apiMissing, setApiMissing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const analysisRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef(detail);
  const asksRef = useRef(asks);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  useEffect(() => { asksRef.current = asks; }, [asks]);

  // ─── 起盘（单次调用，返回 chart 给统一流程使用）──────────
  // 开源版不含后端 /api/generate：直接用本仓库的排盘引擎在浏览器里起盘
  const generateChart = useCallback(async (info: BirthInfo): Promise<ZiweiChart | null> => {
    try {
      return buildChart(info);
    } catch {
      return null;
    }
  }, []);

  // 表单是否填齐
  const isFormReady = (f: BirthFormState | null): boolean =>
    !!(f && f.year && f.month && f.day && f.gender && (f.unknownTime || (f.clockHour !== '' && f.clockMinute !== '')));

  // ─── 统一入口：起盘 + 合盘分析 ─────────────────────────────
  const ensureCharts = useCallback(async (): Promise<[ZiweiChart, ZiweiChart] | null> => {
    let cA = chartA;
    let cB = chartB;
    const [newA, newB] = await Promise.all([
      cA ? Promise.resolve(cA) : generateChart(formToBirthInfo(formA!)),
      cB ? Promise.resolve(cB) : generateChart(formToBirthInfo(formB!)),
    ]);
    cA = newA;
    cB = newB;
    if (!cA || !cB) return null;
    if (!chartA) setChartA(cA);
    if (!chartB) setChartB(cB);
    return [cA, cB];
  }, [chartA, chartB, formA, formB, generateChart]);

  const loadHemingCorpus = useCallback(async (topics: TopicKey[] = ['love'], switchTab = true) => {
    setFormError(null);
    if (!isFormReady(formA) || !isFormReady(formB)) {
      setFormError('请先填写双方完整出生信息');
      return;
    }
    setCorpusLoading(true);
    setAnalysisError(false);
    try {
      const pair = await ensureCharts();
      if (!pair) {
        setAnalysisError(true);
        return;
      }
      const res = await fetch('/api/corpus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { chart: pair[0], topics, who: '甲方' },
            { chart: pair[1], topics, who: '乙方' },
          ],
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json() as { text?: string };
      setCorpus(data.text ?? '');
      if (switchTab) setView('corpus');
    } catch {
      setAnalysisError(true);
    } finally {
      setCorpusLoading(false);
    }
  }, [formA, formB, ensureCharts]);

  const runAi = useCallback(async (q?: string, mode: 'detail' | 'ask' = 'detail') => {
    setFormError(null);
    if (!isFormReady(formA) || !isFormReady(formB)) {
      setFormError('请先填写双方完整出生信息');
      return;
    }
    setView('ai');
    setAiKind(mode);
    setAnalyzing(true);
    setAnalysisError(false);
    setApiMissing(false);
    const prior = [
      detailRef.current?.content ? `【细致推演】\n${detailRef.current.content}` : '',
      ...asksRef.current.map(item => `【追问】${item.question}\n${item.content}`),
    ].filter(Boolean).join('\n\n');
    const questionForApi = mode === 'detail'
      ? (prior
          ? `下面是已经写过的内容：\n${prior}\n\n请在此基础上做细致推演，按【缘分总判】【夫妻与福德】【矛盾与互补】【建议】四节写。不要复述成稿。`
          : undefined)
      : (prior ? `已有对话：\n${prior}\n\n请只回答这个追问：\n${q ?? ''}` : q);
    if (mode === 'detail') {
      setDetail({ reasoning: '', content: '' });
      setAsks([]);
    } else {
      setAsks(prev => [...prev, { question: q ?? '', reasoning: '', content: '' }]);
    }
    try {
      const pair = await ensureCharts();
      if (!pair) {
        setAnalysisError(true);
        setAnalyzing(false);
        return;
      }
      void loadHemingCorpus(hemingTopics(q), false);
      const res = await fetch('/api/heming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chartA: pair[0],
          chartB: pair[1],
          question: questionForApi,
          corpus: mode === 'ask' ? corpus : undefined,
        }),
      });
      if (res.status === 404) { setApiMissing(true); throw new Error('api-missing'); }
      if (!res.ok || !res.body) throw new Error();
      await readSse(res.body, (ev) => {
        const text = ev.delta?.text ?? '';
        const reasoning = ev.delta?.reasoning ?? '';
        if (!text && !reasoning) return;
        if (mode === 'detail') {
          setDetail(prev => ({
            reasoning: `${prev?.reasoning ?? ''}${reasoning}`,
            content: `${prev?.content ?? ''}${text}`,
          }));
        } else {
          setAsks(prev => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              reasoning: last.reasoning + reasoning,
              content: last.content + text,
            };
            return next;
          });
        }
      });
      setTimeout(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch {
      setAnalysisError(true);
    } finally {
      setAnalyzing(false);
    }
  }, [formA, formB, ensureCharts, loadHemingCorpus, corpus]);

  const cardStyle = {
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.9)',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(200,160,60,0.2)'}`,
    borderRadius: '16px',
    padding: '24px',
  };

  const labelStyle = {
    fontSize: '13px', letterSpacing: '0.4em', color: 'var(--ac)', opacity: 0.7,
    marginBottom: '16px', display: 'block',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
      {/* 顶栏 */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: isDark ? 'rgba(2,8,16,0.88)' : 'rgba(250,245,235,0.92)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--bdr)',
        display: 'flex', alignItems: 'center', padding: '0 24px', height: '52px', gap: '16px',
      }}>
        <button
          onClick={() => router.push('/')}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', fontSize: '16px',
            color: 'var(--tx-3)', background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '16px' }}>‹</span>
          <span>返回</span>
        </button>
        <div style={{ width: '1px', height: '20px', background: 'var(--bdr-med)' }} />
        <span style={{ fontSize: '16px', color: 'var(--ac)', letterSpacing: '0.2em' }}>合盘分析</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '15px', color: 'var(--tx-3)' }}>感情 · 合伙 · 亲子 · 朋友</span>
      </header>

      {/* 主体 */}
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ fontSize: '28px', color: 'var(--ac)', opacity: 0.15, marginBottom: '12px' }}>☯</div>
          <h1 style={{ fontSize: '28px', fontWeight: 600, letterSpacing: '0.15em', color: 'var(--tx-0)', marginBottom: '8px' }}>
            紫微合盘
          </h1>
          <p style={{ fontSize: '16px', color: 'var(--tx-3)', lineHeight: 1.6 }}>
            输入两个人的出生信息，AI 基于倪海厦体系分析双方命盘的缘分匹配度、感情走向与相处建议
          </p>
        </div>

        {/* 双栏表单 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}
          className="heming-grid">
          {/* 甲方 */}
          <div style={cardStyle}>
            <span style={labelStyle}>甲方 — A</span>
            <BirthForm
              hideSubmit
              onSubmit={() => {}}
              onFormSave={setFormA}
            />
          </div>

          {/* 乙方 */}
          <div style={cardStyle}>
            <span style={labelStyle}>乙方 — B</span>
            <BirthForm
              hideSubmit
              onSubmit={() => {}}
              onFormSave={setFormB}
            />
          </div>
        </div>

        {/* ═══ 大合盘分析框（视觉中心，始终显示）════════════════ */}
        <div ref={analysisRef} style={{
          ...cardStyle,
          minHeight: '320px',
          padding: '32px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: (!detail && asks.length === 0 && !analyzing && !corpus && !corpusLoading) ? 'center' : 'flex-start',
        }}>
          {/* 区块标题 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: (detail || asks.length || analyzing || corpus || corpusLoading) ? '20px' : '24px' }}>
            <span style={{ color: 'var(--ac)', opacity: 0.6 }}>◉</span>
            <span style={{ fontSize: '14px', letterSpacing: '0.3em', color: 'var(--tx-3)' }}>合盘分析 · HEMING</span>
          </div>

          {/* 状态分支 */}
          {!detail && asks.length === 0 && !analyzing && !corpus && !corpusLoading && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '16px', color: 'var(--tx-3)', marginBottom: '24px', lineHeight: 1.7 }}>
                填好双方出生信息后，先读成稿<br />
                再到 AI 推演里追问细节，或做细致推演
              </div>
              <button
                onClick={() => { void loadHemingCorpus(); }}
                style={{
                  padding: '14px 40px', borderRadius: 'var(--r-pill)', border: 'none',
                  background: 'linear-gradient(135deg, #9a6210, #c88020)',
                  color: '#fff8e8', fontSize: '16px', fontWeight: 600,
                  letterSpacing: '0.15em', cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(140,100,20,0.25)',
                  transition: 'transform 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
              >
                读取成稿
              </button>
              {formError && (
                <div style={{ marginTop: '20px', fontSize: '15px', color: '#dc2626' }}>
                  {formError}
                </div>
              )}
            </div>
          )}

          {(corpus || corpusLoading || detail || asks.length > 0 || analyzing) && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {([['corpus', '成稿'], ['ai', 'AI推演']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: '10px', cursor: 'pointer',
                    border: `1px solid ${view === id ? 'var(--ac)' : 'var(--bdr)'}`,
                    background: view === id ? 'rgba(200,160,60,0.12)' : 'transparent',
                    color: view === id ? 'var(--ac)' : 'var(--tx-3)',
                    fontSize: '16px', letterSpacing: '0.12em',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {view === 'corpus' && (corpus || corpusLoading) && (
            <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {corpusLoading && !corpus ? (
                <div style={{ fontSize: '16px', color: 'var(--tx-3)' }}>正在读取对应年份的成稿…</div>
              ) : (
                <AiContent text={corpus} />
              )}
            </div>
          )}

          {view === 'ai' && (corpus || detail || asks.length > 0 || analyzing || corpusLoading) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ maxHeight: 280, overflowY: 'auto', padding: '14px 16px', borderRadius: 12, border: '1px solid var(--bdr)' }}>
                <div style={{ fontSize: '14px', letterSpacing: '0.2em', color: 'var(--tx-3)', marginBottom: 8 }}>原文</div>
                {corpus ? <AiContent text={corpus} /> : <div style={{ fontSize: '16px', color: 'var(--tx-3)' }}>正在读取原文…</div>}
              </div>
              {detail && (
                <div style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid var(--ac-bdr)', background: 'var(--ac-bg)' }}>
                  {detail.reasoning ? (
                    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--bdr)' }}>
                      <button
                        type="button"
                        onClick={() => setOpenThink(prev => ({ ...prev, detail: !prev.detail }))}
                        style={{ fontSize: 15, color: 'var(--tx-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        {openThink.detail ? '收起思考过程' : '展开思考过程'}
                        {analyzing && aiKind === 'detail' && !detail.content ? ' · 思考中' : ''}
                      </button>
                      {openThink.detail && (
                        <div style={{ marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
                          <AiContent text={detail.reasoning} streaming={analyzing && aiKind === 'detail' && !detail.content} />
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div style={{ fontSize: '14px', letterSpacing: '0.2em', color: 'var(--ac)', marginBottom: 10 }}>细致推演</div>
                  {detail.content ? (
                    <AiContent text={detail.content} streaming={analyzing && aiKind === 'detail'} />
                  ) : (
                    <div style={{ fontSize: 16, color: 'var(--tx-3)' }}>{analyzing && aiKind === 'detail' ? '正在整理这一段…' : '这一段没有正文。'}</div>
                  )}
                </div>
              )}
              {asks.map((item, index) => (
                <div key={`${item.question}-${index}`} style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid var(--bdr)', background: 'var(--bg-card)' }}>
                  <div style={{ fontSize: 16, color: 'var(--tx-0)', marginBottom: 10 }}>{item.question}</div>
                  {item.reasoning ? (
                    <div style={{ marginBottom: 12 }}>
                      <button
                        type="button"
                        onClick={() => setOpenThink(prev => ({ ...prev, [`ask-${index}`]: !prev[`ask-${index}`] }))}
                        style={{ fontSize: 15, color: 'var(--tx-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        {openThink[`ask-${index}`] ? '收起思考过程' : '展开思考过程'}
                      </button>
                      {openThink[`ask-${index}`] && (
                        <div style={{ marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
                          <AiContent text={item.reasoning} />
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div style={{ fontSize: '14px', letterSpacing: '0.2em', color: 'var(--ac)', marginBottom: 10 }}>追问</div>
                  {item.content ? <AiContent text={item.content} streaming={analyzing && aiKind === 'ask' && index === asks.length - 1} /> : (
                    <div style={{ fontSize: 16, color: 'var(--tx-3)' }}>正在整理这一段…</div>
                  )}
                </div>
              ))}
              {!detail && asks.length === 0 && !analyzing && (
                <div style={{ fontSize: '16px', color: 'var(--tx-3)', lineHeight: 1.7 }}>
                  上面是双方原文。可以追问其中某一句，或做细致推演。
                </div>
              )}
            </div>
          )}

          {analysisError && (
            <div style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--bdr)', background: 'var(--bg-card)', fontSize: '16px', color: 'var(--tx-2)', marginTop: '12px' }}>
              {apiMissing
                ? '开源版不含合盘 AI 分析接口（/api/heming），需要你自己实现后才能用。两人的命盘可以分别到「排盘」页（/chart）查看。'
                : '分析暂时不可用，请重试。'}
            </div>
          )}
        </div>

        {/* ═══ 针对合盘的追问聊天框（仅分析完成后显示）═══════════ */}
        {view === 'ai' && (corpus || detail || asks.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
            <button
              type="button"
              onClick={() => { void runAi(undefined, 'detail'); }}
              disabled={analyzing}
              style={{
                padding: '10px 20px', borderRadius: 'var(--r-sm)', border: 'none',
                background: analyzing ? 'var(--bg-2)' : 'linear-gradient(135deg, #9a6210, #c88020)',
                color: analyzing ? 'var(--tx-3)' : '#fff8e8',
                fontSize: '16px', fontWeight: 600, letterSpacing: '0.12em',
                cursor: analyzing ? 'not-allowed' : 'pointer',
              }}
            >
              {analyzing ? '推演中…' : '细致推演'}
            </button>
            <div style={{ fontSize: '14px', letterSpacing: '0.2em', color: 'var(--tx-3)', marginBottom: '4px' }}>
              追问原文里的细节
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                '感情匹配度如何？',
                '适合合伙创业吗？',
                '两人结婚是否合适？',
                '哪方面最容易产生矛盾？',
                '财运是否互补？',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setQuestion(q); void runAi(q, 'ask'); }}
                  disabled={analyzing}
                  style={{
                    fontSize: '15px', padding: '8px 16px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid var(--bdr-med)',
                    background: 'transparent', color: 'var(--tx-2)',
                    cursor: analyzing ? 'not-allowed' : 'pointer',
                    opacity: analyzing ? 0.5 : 1,
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { if (!analyzing) (e.currentTarget as HTMLElement).style.borderColor = 'var(--ac-bdr)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--bdr-med)'; }}
                >
                  {q}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !analyzing && question.trim()) void runAi(question, 'ask'); }}
                placeholder="追问原文里的某一句"
                disabled={analyzing}
                className="input-base"
                style={{ fontSize: '16px', flex: 1 }}
              />
              <button
                onClick={() => { if (question.trim()) void runAi(question, 'ask'); }}
                disabled={analyzing || !question.trim()}
                style={{
                  padding: '10px 20px', borderRadius: 'var(--r-sm)', border: 'none',
                  background: analyzing ? 'var(--bg-2)' : 'var(--tx-0)',
                  color: analyzing ? 'var(--tx-3)' : 'white',
                  fontSize: '16px', fontWeight: 500,
                  cursor: analyzing ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {analyzing ? '分析中…' : '追问'}
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 680px) {
          .heming-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
