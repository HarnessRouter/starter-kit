import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, CircleStop, Clock3,
  Download, Heart, History, Home, LifeBuoy, LoaderCircle, Menu, MessageCircle,
  Phone, RefreshCw, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { api, apiHeaders, SSEParser, type StreamEvent } from './api';
import { normalizeGuideText } from './guide';
import type { AgentFile, SessionRecord } from './types';

type Config = { user: { id: string; name: string; initials: string }; users: { id: string; name: string; initials: string }[]; agent: { name: string; model: string } };
const quickPrompts = [
  { icon: MessageCircle, tone: 'lavender', title: 'Prepare for our next visit', text: 'Help me prepare for our next oncology appointment. Give me a short checklist and questions to ask.' },
  { icon: LifeBuoy, tone: 'mint', title: 'Make today a little easier', text: 'My child is having a hard day during treatment. Help me make a gentle plan for comfort, routines, and what to note for the care team.' },
  { icon: BookOpen, tone: 'peach', title: 'Explain care in plain words', text: 'Help me understand a care instruction in plain language and list what I should confirm with the oncology team.' },
];

function extractTurnText(payload: any): string {
  const turns = Array.isArray(payload) ? payload : payload?.turns || payload?.data || [];
  const values: string[] = [];
  const walk = (value: any) => {
    if (!value || typeof value === 'string') return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value === 'object') {
      if ((value.type === 'output_text' || value.type === 'text') && typeof value.text === 'string') values.push(value.text);
      Object.values(value).forEach(walk);
    }
  };
  turns.slice(-2).forEach(walk);
  return values.at(-1) || '';
}

function Guide({ text }: { text: string }) {
  const displayText = normalizeGuideText(text);
  return <div className="guide-copy">{displayText.split('\n').map((line, index) => {
    const clean = line.trim();
    if (!clean) return <div className="guide-space" key={index} />;
    if (clean.startsWith('## ')) return <h3 key={index}>{clean.slice(3)}</h3>;
    if (clean.startsWith('# ')) return <h2 key={index}>{clean.slice(2)}</h2>;
    if (/^[-*] /.test(clean)) return <div className="guide-bullet" key={index}><i /><span>{clean.slice(2).replace(/^\[[ xX]\]\s*/, '').replace(/\*\*/g, '')}</span></div>;
    if (/^\d+\. /.test(clean)) return <div className="guide-bullet numbered" key={index}><i>{clean.match(/^\d+/)?.[0]}</i><span>{clean.replace(/^\d+\. /, '').replace(/\*\*/g, '')}</span></div>;
    return <p key={index}>{clean.replace(/\*\*/g, '')}</p>;
  })}</div>;
}

export default function App() {
  const [userId, setUserId] = useState(localStorage.getItem('lumacare-user') || 'alice');
  const [config, setConfig] = useState<Config | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [input, setInput] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'incomplete' | 'failed' | 'cancelled'>('idle');
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isFollowing, setIsFollowing] = useState(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const resultBodyRef = useRef<HTMLDivElement>(null);
  const activeSessionRef = useRef<SessionRecord | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef('');
  const frameRef = useRef<number | null>(null);

  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  useEffect(() => {
    if (status !== 'running') { setElapsedSeconds(0); return; }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status !== 'running') return;
    const mobile = window.matchMedia('(max-width: 850px)').matches;
    window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: mobile ? 'smooth' : 'auto', block: 'start' }), 80);
  }, [status]);

  useEffect(() => {
    const body = resultBodyRef.current;
    if (!body || status !== 'running' || !isFollowing) return;
    body.scrollTop = body.scrollHeight;
  }, [answer, status, isFollowing]);

  const loadSessions = useCallback(async () => {
    const result = await api<{ sessions: SessionRecord[] }>('/api/sessions', userId);
    setSessions(result.sessions);
  }, [userId]);

  useEffect(() => {
    localStorage.setItem('lumacare-user', userId);
    setActiveSession(null); setAnswer(''); setFiles([]); setStatus('idle');
    api<Config>('/api/config', userId).then(setConfig).catch((e) => setError(e.message));
    loadSessions().catch(() => {});
  }, [userId, loadSessions]);

  const refreshSession = useCallback(async (session: SessionRecord) => {
    const data = await api<any>(`/api/sessions/${session.sessionId}`, userId);
    const record = data.record as SessionRecord;
    setActiveSession(record); setStatus(record.status === 'done' ? 'completed' : record.status as any);
    setFiles((data.files?.files || []) as AgentFile[]);
    const recovered = extractTurnText(data.turns); if (recovered) setAnswer(recovered);
    loadSessions().catch(() => {}); return record;
  }, [loadSessions, userId]);

  const handleEvent = useCallback((event: StreamEvent, prompt: string) => {
    if (event.type === 'response.created') {
      const session = { sessionId: event.response?.metadata?.session_id, responseId: event.response?.id, userId, title: prompt.length > 64 ? `${prompt.slice(0, 64)}…` : prompt, prompt, status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      activeSessionRef.current = session; setActiveSession(session);
    } else if (event.type === 'response.output_text.delta') {
      streamBufferRef.current += String(event.delta || '');
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(() => {
        const delta = streamBufferRef.current; streamBufferRef.current = ''; frameRef.current = null;
        setAnswer((value) => value + delta);
      });
    } else if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      const delta = streamBufferRef.current; streamBufferRef.current = ''; frameRef.current = null;
      if (delta) setAnswer((value) => value + delta);
      setStatus(event.type === 'response.completed' ? 'completed' : event.type === 'response.incomplete' ? 'incomplete' : event.response?.status === 'cancelled' ? 'cancelled' : 'failed');
    }
  }, [userId]);

  const runTask = async (continuation?: string) => {
    const prompt = (continuation || input).trim();
    if (!prompt || status === 'running') return;
    setError(''); setAnswer(''); setFiles([]); setIsFollowing(true); setSubmittedPrompt(prompt); setStatus('running'); if (!continuation) setInput('');
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const body: Record<string, string> = { featureKey: 'care_companion', input: prompt };
      if (activeSession && continuation) { body.sessionId = activeSession.sessionId; body.previousResponseId = activeSession.responseId; }
      const response = await fetch('/api/runs', { method: 'POST', headers: apiHeaders(userId, true), body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok || !response.body) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'LumaCare could not start your guide.'); }
      const parser = new SSEParser(); const reader = response.body.getReader(); const decoder = new TextDecoder();
      while (true) { const { done, value } = await reader.read(); if (done) break; parser.push(decoder.decode(value, { stream: true })).forEach((event) => handleEvent(event, prompt)); }
      parser.flush().forEach((event) => handleEvent(event, prompt));
      setTimeout(() => setActiveSession((current) => { if (current) refreshSession(current).catch(() => {}); return current; }), 700);
    } catch (e) { if ((e as Error).name !== 'AbortError') { setStatus('failed'); setError((e as Error).message); } }
    finally { abortRef.current = null; }
  };

  const openSession = async (session: SessionRecord) => { setHistoryOpen(false); setAnswer(''); setLoadingSession(true); try { await refreshSession(session); } catch (e) { setError((e as Error).message); setStatus('failed'); } finally { setLoadingSession(false); } };
  const cancelRun = async () => {
    abortRef.current?.abort(); setInput((value) => value || submittedPrompt); setStatus('cancelled');
    const session = activeSessionRef.current;
    if (session) api(`/api/sessions/${session.sessionId}/cancel`, userId, { method: 'POST' }).catch(() => {});
  };
  const usePrompt = (text: string) => { setInput(text); requestAnimationFrame(() => composerRef.current?.focus()); };
  const downloadGuide = async () => {
    if (!activeSession || !files.length) return;
    const guide = files.find((file) => file.path.endsWith('lumacare-guide.md')) || files[0];
    const response = await fetch(`/api/sessions/${activeSession.sessionId}/files/${guide.file_id}/download`, { headers: apiHeaders(userId) });
    if (!response.ok) return setError('The guide could not be downloaded.');
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'lumacare-guide.md'; link.click(); URL.revokeObjectURL(url);
  };

  const user = config?.users.find((item) => item.id === userId);
  return <div className="lumacare-shell">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="logo"><span><Heart size={19} fill="currentColor" /></span><strong>LumaCare</strong><button onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18} /></button></div>
      <nav aria-label="Primary navigation"><button className="active"><Home size={18} />Home</button><button onClick={() => setHistoryOpen(true)}><MessageCircle size={18} />Care conversations</button><button onClick={() => usePrompt(quickPrompts[0].text)}><CalendarDays size={18} />Visit prep</button><button onClick={() => usePrompt('Share gentle, age-appropriate ways I can talk with my child about treatment and difficult days.')}><BookOpen size={18} />Family guides</button></nav>
      <div className="sidebar-note"><ShieldCheck size={18} /><div><strong>Private by design</strong><p>Avoid names, birth dates, record numbers, or addresses.</p></div></div>
      <div className="profile-row"><span>{user?.initials || 'AM'}</span><div><strong>{user?.name || 'Alex Morgan'}</strong><small>Caregiver account</small></div><select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Demo caregiver">{config?.users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    </aside>
    <main>
      <header className="topbar"><button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button><div className="care-team"><span><ShieldCheck size={15} /></span><div><strong>Connected with care guidance</strong><small>AI support for families</small></div></div><button className="history-button" onClick={() => setHistoryOpen(true)} aria-label="Past guides"><History size={17} /><span>Past guides</span></button></header>
      <div className={`content-wrap ${status === 'running' || answer ? 'has-active-guide' : ''}`}>
        <section className="hero"><div><span className="eyebrow"><Sparkles size={13} />HERE WITH YOU</span><h1>One next step<br /><em>at a time.</em></h1><p>Practical, compassionate support for the moments between appointments.</p></div><div className="hero-art" aria-hidden="true"><div className="sun" /><div className="hill one" /><div className="hill two" /><div className="family"><i /><i /><i /></div></div></section>
        <section className="urgent-strip"><Phone size={18} /><div><strong>Think this may be an emergency?</strong><span>Call local emergency services. For fever or infection concerns during treatment, contact your child’s oncology team now and follow their fever plan.</span></div></section>
        {!answer && status !== 'running' && status !== 'cancelled' ? <><section className="quick-section"><div className="section-heading"><div><span>START HERE</span><h2>What would help right now?</h2></div><p>You don’t need the perfect words.</p></div><div className="quick-grid">{quickPrompts.map(({ icon: Icon, tone, title, text }) => <button key={title} className={`quick-card ${tone}`} onClick={() => usePrompt(text)}><span><Icon size={20} /></span><div><strong>{title}</strong><small>{text.split('.')[0]}.</small></div><ChevronRight size={18} /></button>)}</div></section><section className="reassurance"><div className="quote-mark">“</div><blockquote>There is no right way to feel today.<br /><em>Small steps still count.</em></blockquote><div className="leaf" /></section></> :
          <section className="result-card" ref={resultRef} aria-busy={status === 'running'}><div className="result-head"><div><span className="luma-mark"><Heart size={16} fill="currentColor" /></span><div><strong>Your LumaCare guide</strong><small>{loadingSession ? 'Opening your saved guide…' : status === 'running' && answer ? 'Writing your guide live…' : status === 'running' ? 'Preparing a thoughtful response…' : status === 'cancelled' ? 'Guide stopped' : 'Ready to review with your care team'}</small></div></div>{status === 'running' && answer && <span className="live-status"><i />Live</span>}{status === 'completed' && files.length > 0 && <button onClick={downloadGuide}><Download size={16} />Save guide</button>}</div>
            <div className="result-body" ref={resultBodyRef} onScroll={(event) => { const body = event.currentTarget; setIsFollowing(body.scrollHeight - body.scrollTop - body.clientHeight < 48); }}>
              {status === 'running' && !answer ? <div className="thinking" role="status" aria-live="polite"><div className="thinking-intro"><LoaderCircle className="spin" size={24} /><div><strong>Putting your guide together</strong><span>This usually takes 15–30 seconds. You can safely stop at any time.</span></div></div><ol className="progress-steps"><li className="done"><Check size={14} />Request received</li><li className={elapsedSeconds >= 3 ? 'done' : 'active'}>{elapsedSeconds >= 3 ? <Check size={14} /> : <LoaderCircle className="spin" size={14} />}Organizing the next steps</li><li className={elapsedSeconds >= 10 ? 'active' : ''}>{elapsedSeconds >= 10 ? <LoaderCircle className="spin" size={14} /> : <span>3</span>}Writing your care guide</li></ol><small className="elapsed">Working for {elapsedSeconds}s</small></div> : status === 'cancelled' && !answer ? <div className="cancelled-state" role="status"><CircleStop size={24} /><div><strong>Guide stopped</strong><span>Your message is back in the composer, ready to edit or try again.</span></div></div> : <div role="status" aria-live="polite"><Guide text={answer} /></div>}
              {status === 'incomplete' && <button className="continue-button" onClick={() => runTask('Continue the current guide, keeping it concise and completing any missing sections.')}><RefreshCw size={15} />Continue this guide</button>}
            </div>
            {status === 'running' && answer && !isFollowing && <button className="jump-latest" onClick={() => { setIsFollowing(true); const body = resultBodyRef.current; if (body) body.scrollTop = body.scrollHeight; }}>Jump to latest <ArrowRight size={14} /></button>}
          </section>}
        <section className="composer-section"><div className="composer-label"><label htmlFor="care-question">Tell LumaCare what’s happening</label><span>Don’t include identifying details</span></div><div className="composer"><textarea ref={composerRef} id="care-question" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runTask(); } }} placeholder="For example: We have an appointment Friday and I’m not sure what to ask…" rows={3} disabled={status === 'running'} />{status === 'running' ? <button className="send-button stop" onClick={cancelRun} aria-label="Stop guide"><CircleStop size={19} /></button> : <button className="send-button" onClick={() => runTask()} disabled={!input.trim()} aria-label="Create care guide"><ArrowRight size={20} /></button>}</div><div className="composer-foot"><span><Sparkles size={12} />Powered by HarnessRouter</span><span>Supportive guidance, not medical advice</span></div></section>
      </div>
    </main>
    {historyOpen && <div className="modal-backdrop" onMouseDown={() => setHistoryOpen(false)}><section className="history-panel" onMouseDown={(e) => e.stopPropagation()}><div className="history-head"><div><span><Clock3 size={18} /></span><div><strong>Past care guides</strong><small>Private to this caregiver account</small></div></div><button onClick={() => setHistoryOpen(false)} aria-label="Close history"><X size={18} /></button></div><div className="history-list">{sessions.length === 0 ? <div className="empty-history"><History size={26} /><p>Your saved guides will appear here.</p></div> : sessions.map((session) => <button key={session.sessionId} onClick={() => openSession(session)}><span className={`session-status ${session.status}`}><Check size={12} /></span><div><strong>{session.title}</strong><small>{new Date(session.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></div><ChevronRight size={17} /></button>)}</div></section></div>}
    {error && <div className="error-toast" role="alert"><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
  </div>;
}
