import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp, Bot, Braces, Check, ChevronRight, CircleStop, Clock3, Code2,
  Download, FileCode2, Files, GitBranch, History, LoaderCircle, PanelLeft,
  RefreshCw, Search, Sparkles, TerminalSquare, X,
} from 'lucide-react';
import { api, apiHeaders, SSEParser, type StreamEvent } from './api';
import type { AgentFile, SessionRecord } from './types';

type Config = {
  user: { id: string; name: string; initials: string };
  users: { id: string; name: string; initials: string }[];
  agent: { name: string; model: string };
};

const starterTasks = [
  { icon: Search, title: 'Understand a codebase', prompt: 'Inspect this project and explain its architecture, main data flow, and the best place to add a new feature.' },
  { icon: Braces, title: 'Implement a feature', prompt: 'Add a small, well-tested feature to this project. Explain the plan first, then make the change and verify it.' },
  { icon: TerminalSquare, title: 'Debug a failure', prompt: 'Investigate the current failing test or build error, identify the root cause, and propose the smallest safe fix.' },
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

function AgentOutput({ text }: { text: string }) {
  return <div className="agent-output">{text.split('\n').map((line, index) => {
    const clean = line.trim();
    if (!clean) return <div className="output-space" key={index} />;
    if (clean.startsWith('```')) return <div className="code-divider" key={index}><Code2 size={13} /> code</div>;
    if (clean.startsWith('## ')) return <h3 key={index}>{clean.slice(3)}</h3>;
    if (clean.startsWith('# ')) return <h2 key={index}>{clean.slice(2)}</h2>;
    if (/^[-*] /.test(clean)) return <div className="output-row" key={index}><i /><span>{clean.slice(2).replace(/\*\*/g, '')}</span></div>;
    if (/^\d+\. /.test(clean)) return <div className="output-row numbered" key={index}><i>{clean.match(/^\d+/)?.[0]}</i><span>{clean.replace(/^\d+\. /, '').replace(/\*\*/g, '')}</span></div>;
    return <p key={index}>{clean.replace(/\*\*/g, '')}</p>;
  })}</div>;
}

export default function App() {
  const [userId, setUserId] = useState(localStorage.getItem('coding-demo-user') || 'alice');
  const [config, setConfig] = useState<Config | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'incomplete' | 'failed' | 'cancelled'>('idle');
  const [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const loadSessions = useCallback(async () => {
    const result = await api<{ sessions: SessionRecord[] }>('/api/sessions', userId);
    setSessions(result.sessions);
  }, [userId]);

  useEffect(() => {
    localStorage.setItem('coding-demo-user', userId);
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
    if (event.type === 'response.created') setActiveSession({ sessionId: event.response?.metadata?.session_id, responseId: event.response?.id, userId, title: prompt.length > 64 ? `${prompt.slice(0, 64)}…` : prompt, prompt, status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    else if (event.type === 'response.output_text.delta') setAnswer((value) => value + String(event.delta || ''));
    else if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') setStatus(event.type === 'response.completed' ? 'completed' : event.type === 'response.incomplete' ? 'incomplete' : event.response?.status === 'cancelled' ? 'cancelled' : 'failed');
  }, [userId]);

  const runTask = async (continuation?: string) => {
    const prompt = (continuation || input).trim();
    if (!prompt || status === 'running') return;
    setError(''); setAnswer(''); setFiles([]); setStatus('running'); if (!continuation) setInput('');
    try {
      const body: Record<string, string> = { featureKey: 'coding_assistant', input: prompt };
      if (activeSession && continuation) { body.sessionId = activeSession.sessionId; body.previousResponseId = activeSession.responseId; }
      const response = await fetch('/api/runs', { method: 'POST', headers: apiHeaders(userId, true), body: JSON.stringify(body) });
      if (!response.ok || !response.body) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'The coding agent could not start.'); }
      const parser = new SSEParser(); const reader = response.body.getReader(); const decoder = new TextDecoder();
      while (true) { const { done, value } = await reader.read(); if (done) break; parser.push(decoder.decode(value, { stream: true })).forEach((event) => handleEvent(event, prompt)); }
      parser.flush().forEach((event) => handleEvent(event, prompt));
      setTimeout(() => setActiveSession((current) => { if (current) refreshSession(current).catch(() => {}); return current; }), 700);
    } catch (e) { setStatus('failed'); setError((e as Error).message); }
  };

  const openSession = async (session: SessionRecord) => { setHistoryOpen(false); setAnswer(''); setStatus('running'); try { await refreshSession(session); } catch (e) { setError((e as Error).message); setStatus('failed'); } };
  const cancelRun = async () => { if (!activeSession) return; await api(`/api/sessions/${activeSession.sessionId}/cancel`, userId, { method: 'POST' }); setStatus('cancelled'); };
  const usePrompt = (prompt: string) => { setInput(prompt); requestAnimationFrame(() => composerRef.current?.focus()); };
  const downloadFiles = async () => {
    if (!activeSession) return;
    const response = await fetch(`/api/sessions/${activeSession.sessionId}/archive`, { headers: apiHeaders(userId) });
    if (!response.ok) return setError('The session files could not be downloaded.');
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'coding-session-files.zip'; link.click(); URL.revokeObjectURL(url);
  };

  const user = config?.users.find((item) => item.id === userId);
  return <div className="code-shell">
    <aside className="activity-bar"><div className="product-mark"><Sparkles size={17} /></div><button className="active" aria-label="Explorer"><Files size={20} /></button><button aria-label="Search"><Search size={20} /></button><button aria-label="Source control"><GitBranch size={20} /></button><button aria-label="Agent"><Bot size={20} /></button><span /><button aria-label="Account" className="avatar">{user?.initials || 'AM'}</button></aside>
    <aside className="explorer"><div className="explorer-title"><span>EXPLORER</span><PanelLeft size={15} /></div><strong>HARVARD-WORKSHOP</strong><div className="file-tree"><button><ChevronRight size={14} /><span className="folder">src</span></button><button><ChevronRight size={14} /><span className="folder">server</span></button><button><ChevronRight size={14} /><span className="folder">tests</span></button><button><FileCode2 size={14} /><span>README.md</span></button><button><FileCode2 size={14} /><span>package.json</span></button></div><div className="explorer-bottom"><button onClick={() => setHistoryOpen(true)}><History size={15} /> Agent history <span>{sessions.length}</span></button></div></aside>
    <main className="workspace">
      <header className="editor-tabs"><div className="tab active"><Bot size={14} /> HarnessRouter Agent <X size={13} /></div><div className="workspace-actions"><span className={`status-dot ${status}`} />{status === 'running' ? 'Agent working' : 'Ready'}</div></header>
      <section className="agent-pane">
        <div className="agent-header"><div><span className="agent-icon"><Bot size={19} /></span><div><strong>Cursor-style coding agent</strong><small>{config?.agent.model || 'HarnessRouter'}</small></div></div><div className="header-actions"><select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Demo developer">{config?.users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={() => setHistoryOpen(true)}><Clock3 size={15} /> History</button></div></div>
        <div className="conversation">
          {!answer && status !== 'running' ? <section className="welcome"><span className="welcome-mark"><Sparkles size={23} /></span><p className="kicker">HARNESSROUTER AT HARVARD</p><h1>Build a Cursor in<br /><em>3 steps.</em></h1><p className="intro">A coding agent that can understand a project, plan changes, stream its work, and preserve the session for follow-up.</p><div className="starter-grid">{starterTasks.map(({ icon: Icon, title, prompt }) => <button key={title} onClick={() => usePrompt(prompt)}><span><Icon size={18} /></span><strong>{title}</strong><small>{prompt}</small><ChevronRight size={16} /></button>)}</div></section> : <section className="response-card"><div className="response-title"><div><span><Bot size={16} /></span><div><strong>HarnessRouter Agent</strong><small>{status === 'running' ? 'Working through the repository…' : 'Task response'}</small></div></div>{files.length > 0 && <button onClick={downloadFiles}><Download size={15} /> Download files</button>}</div>{status === 'running' && !answer ? <div className="thinking"><LoaderCircle className="spin" size={20} /> Reading context and planning the change…</div> : <AgentOutput text={answer} />}{status === 'incomplete' && <button className="continue" onClick={() => runTask('Continue from the current state and finish the task.')}><RefreshCw size={15} /> Continue</button>}</section>}
        </div>
        <section className="composer-wrap"><div className="composer"><textarea ref={composerRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runTask(); } }} placeholder="Ask the agent to inspect, explain, debug, or change the project…" rows={3} disabled={status === 'running'} />{status === 'running' ? <button className="send stop" onClick={cancelRun} aria-label="Stop agent"><CircleStop size={19} /></button> : <button className="send" onClick={() => runTask()} disabled={!input.trim()} aria-label="Run task"><ArrowUp size={19} /></button>}</div><div className="composer-meta"><span><Sparkles size={12} /> Powered by HarnessRouter</span><span>Enter to send · Shift+Enter for a new line</span></div></section>
      </section>
      <footer className="statusbar"><span><GitBranch size={12} /> main</span><span><Check size={12} /> Workshop demo</span><span className="grow" /><span>HarnessRouter connected</span></footer>
    </main>
    {historyOpen && <div className="modal-backdrop" onMouseDown={() => setHistoryOpen(false)}><section className="history-panel" onMouseDown={(e) => e.stopPropagation()}><div className="history-head"><div><History size={18} /><div><strong>Agent history</strong><small>Sessions for {user?.name || 'this developer'}</small></div></div><button onClick={() => setHistoryOpen(false)} aria-label="Close history"><X size={18} /></button></div><div className="history-list">{sessions.length === 0 ? <p className="empty-history">Completed tasks will appear here.</p> : sessions.map((session) => <button key={session.sessionId} onClick={() => openSession(session)}><span className={`session-status ${session.status}`}><Check size={11} /></span><div><strong>{session.title}</strong><small>{new Date(session.updatedAt).toLocaleString()}</small></div><ChevronRight size={16} /></button>)}</div></section></div>}
    {error && <div className="error-toast"><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
  </div>;
}
