// Hiring: the recruiter asks, the person taps, the teammate appears. Every screen here is one of
// the recruiter's replies drawn as a form, until the profile, which the person can adjust before
// it becomes a Harness. The recruiter runs on a session of its own per hire.
import React, { useCallback, useRef, useState } from 'react';
import { Menu, RefreshCw } from 'lucide-react';
import { streamTurn } from 'reifyui/harness';
import { useWorkplace } from '../App.jsx';
import { Avatar, AVATARS } from '../lib/avatars.jsx';
import { AVATAR_CHOICES, NAME_MAX, OTHER, answersToText, cleanName, parseBuilderReply } from '../lib/builder.js';
import { createTeammate } from '../lib/teammates.js';

/** After a while on the thinking screen, say so; a turn that is still running is not a page that broke. */
function Slow({ since }) {
  const [now, setNow] = useState(Date.now());
  React.useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const s = since ? Math.floor((now - since) / 1000) : 0;
  if (s < 40) return null;
  return <p className="wp-hire-slow">Still working after {s} s. The recruiter reads its instructions on every turn; a first answer usually takes under half a minute.</p>;
}

const EXAMPLES = ['A research analyst who reads everything first', 'Someone who writes release notes from my bullet points', 'A spreadsheet wrangler for messy CSVs', 'A calm planner who keeps my week straight'];
const MAX_ROUNDS = 3;

export default function NewTeammate({ first = false }) {
  const { me, rec, navigate, refreshTeammates, openDrawer } = useWorkplace();
  const [step, setStep] = useState('start');       // start | thinking | asking | reveal | creating | error
  const [need, setNeed] = useState('');
  const [sid, setSid] = useState('');
  const [qset, setQset] = useState(null);           // { intro, questions }
  const [answers, setAnswers] = useState({});
  const [rounds, setRounds] = useState(0);
  const [profile, setProfile] = useState(null);
  const [progress, setProgress] = useState([]);
  const [err, setErr] = useState('');
  const textRef = useRef('');

  const [thinkingSince, setThinkingSince] = useState(0);
  const ask = useCallback(async (input) => {
    setStep('thinking'); setErr(''); setThinkingSince(Date.now());
    textRef.current = '';
    let started = sid;
    let r;
    try {
      r = await streamTurn({
        sessionId: sid, harnessId: rec.id, input,
        handlers: { onSession: (id) => { started = id; setSid(id); }, onTextDelta: (d) => { textRef.current += d; }, onError: (m) => setErr(String(m || '')) },
      });
    } catch (e) { setErr(e?.message || 'The recruiter did not answer.'); setStep('error'); return; }
    if (r?.connecting) { setErr('Still connecting. Try again in a moment.'); setStep('error'); return; }
    const parsed = parseBuilderReply(textRef.current);
    if (!parsed) { setErr('The recruiter answered in a form this page cannot draw. Ask again.'); setStep('error'); return; }
    if (parsed.type === 'teammate') { setProfile(parsed); setStep('reveal'); return; }
    setQset(parsed); setAnswers({}); setRounds((n) => n + 1); setStep('asking');
  }, [sid, rec]);

  const startWith = (text) => ask(text.trim() ? `I need a teammate: ${text.trim()}` : 'start');
  const start = () => startWith(need);
  const submitAnswers = () => {
    const text = answersToText(qset.questions, answers);
    ask(rounds >= MAX_ROUNDS - 1 ? `${text}\n\nThat is enough; write the profile now.` : text);
  };
  const retry = () => ask(sid ? 'Please answer again with only the JSON object described in your Skill.' : 'start');

  const toggle = (q, opt) => setAnswers((a) => {
    const cur = a[q.id] || { picked: [], other: '' };
    const picked = q.multiple ? (cur.picked.includes(opt) ? cur.picked.filter((x) => x !== opt) : [...cur.picked, opt]) : (cur.picked[0] === opt ? [] : [opt]);
    return { ...a, [q.id]: { ...cur, picked, otherOn: q.multiple ? cur.otherOn : false } };
  });
  const toggleOther = (q) => setAnswers((a) => {
    const cur = a[q.id] || { picked: [], other: '' };
    return { ...a, [q.id]: { ...cur, otherOn: !cur.otherOn, picked: q.multiple ? cur.picked : [] } };
  });
  const answered = qset ? qset.questions.every((q) => { const a = answers[q.id]; return a && (a.picked.length || (a.otherOn && a.other.trim())); }) : false;

  const create = async () => {
    setStep('creating'); setProgress([]); setErr('');
    try {
      const { teammate } = await createTeammate(profile, me, (s) => setProgress((p) => [...p, s]));
      setProgress((p) => [...p, `${teammate.name} joined`]);
      await refreshTeammates();
      navigate(`dm/${teammate.id}`, true);
    } catch (e) { setErr(e?.message || 'The teammate could not be created.'); setStep('reveal'); }
  };

  return (
    <div className="wp-page">
      <header className="wp-head is-page">
        <button type="button" className="wp-iconbtn wp-menubtn" onClick={openDrawer} aria-label="Rooms"><Menu size={20} /></button>
        <div className="wp-head-titles"><h1 className="wp-head-title">New teammate</h1><div className="wp-head-sub">The recruiter asks a few questions, then designs them.</div></div>
      </header>
      <div className="wp-page-scroll">
        <div className="wp-hire">
          {step === 'start' && (
            <section className="wp-hire-card">
              {first ? <div className="wp-hire-hello"><div className="wp-hire-faces">{['fox', 'owl', 'robot', 'whale'].map((a) => <Avatar key={a} id={a} size={44} />)}</div><h2>Welcome to your workplace</h2><p>Nobody works here yet. Hire your first teammate: say what you need, answer a few questions, and they will be at their desk in a minute.</p></div>
                   : <h2>Who do you need?</h2>}
              <label className="wp-hire-label" htmlFor="need">In a sentence, what should they do for you? <span>(optional)</span></label>
              <textarea id="need" className="wp-hire-input" rows={2} value={need} onChange={(e) => setNeed(e.target.value)} placeholder="e.g. keep an eye on competitor pricing and tell me what changed"
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); start(); } }} />
              <div className="wp-hire-examples">{EXAMPLES.map((x) => <button key={x} type="button" className="wp-pill" onClick={() => { setNeed(x); startWith(x); }}>{x}</button>)}</div>
              <div className="wp-hire-acts"><button type="button" className="uic-btn is-primary is-md" onClick={start}>Start</button></div>
            </section>
          )}

          {step === 'thinking' && (
            <section className="wp-hire-card is-center">
              <div className="wp-hire-faces is-think">{AVATAR_CHOICES.slice(0, 6).map((a, i) => <Avatar key={a} id={a} size={36} className={`wp-bob-${i % 3}`} />)}</div>
              <p className="wp-hire-thinking">The recruiter is thinking{rounds ? ' about your answers' : ''}…</p>
              <Slow since={thinkingSince} />
            </section>
          )}

          {step === 'asking' && qset && (
            <section className="wp-hire-card">
              {qset.intro ? <p className="wp-hire-intro">{qset.intro}</p> : null}
              {qset.questions.map((q, qi) => {
                const a = answers[q.id] || { picked: [], other: '', otherOn: false };
                return (
                  <fieldset key={q.id} className="wp-q">
                    <legend className="wp-q-prompt"><span className="wp-q-n">{qi + 1}</span>{q.prompt}{q.multiple ? <span className="wp-q-multi">pick any</span> : null}</legend>
                    <div className="wp-q-opts" role={q.multiple ? 'group' : 'radiogroup'}>
                      {q.options.map((o) => (
                        <button key={o} type="button" role={q.multiple ? 'checkbox' : 'radio'} aria-checked={a.picked.includes(o)}
                                className={`wp-opt${a.picked.includes(o) ? ' is-on' : ''}`} onClick={() => toggle(q, o)}>{o}</button>
                      ))}
                      <button type="button" role={q.multiple ? 'checkbox' : 'radio'} aria-checked={!!a.otherOn} className={`wp-opt is-other${a.otherOn ? ' is-on' : ''}`} onClick={() => toggleOther(q)}>{OTHER}…</button>
                    </div>
                    {a.otherOn ? <input className="wp-hire-input is-sm" value={a.other} autoFocus placeholder="Say it in your words" onChange={(e) => setAnswers((x) => ({ ...x, [q.id]: { ...a, other: e.target.value } }))} /> : null}
                  </fieldset>
                );
              })}
              <div className="wp-hire-acts">
                <span className="wp-hire-step">Round {rounds} of {MAX_ROUNDS}</span>
                <button type="button" className="uic-btn is-primary is-md" onClick={submitAnswers} disabled={!answered}>Continue</button>
              </div>
            </section>
          )}

          {(step === 'reveal' || step === 'creating') && profile && (
            <section className="wp-hire-card is-reveal">
              <div className="wp-reveal-top">
                <Avatar id={profile.avatar} size={96} />
                <div className="wp-reveal-id">
                  <input className="wp-reveal-name" value={profile.name} maxLength={NAME_MAX} aria-label="Name" disabled={step === 'creating'}
                         onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} onBlur={() => setProfile((p) => ({ ...p, name: cleanName(p.name) }))} />
                  <input className="wp-reveal-tag" value={profile.tagline} maxLength={60} aria-label="Tagline" disabled={step === 'creating'} onChange={(e) => setProfile((p) => ({ ...p, tagline: e.target.value }))} />
                  {profile.expertise.length ? <div className="wp-tags">{profile.expertise.map((e) => <span key={e} className="wp-tag">{e}</span>)}</div> : null}
                </div>
              </div>
              {profile.greeting ? <blockquote className="wp-reveal-greeting">“{profile.greeting}”</blockquote> : null}
              {step === 'reveal' && (
                <>
                  <div className="wp-reveal-faces" role="radiogroup" aria-label="Face">
                    {AVATAR_CHOICES.map((a) => (
                      <button key={a} type="button" role="radio" aria-checked={profile.avatar === a} className={`wp-face${profile.avatar === a ? ' is-on' : ''}`} title={AVATARS[a].label} onClick={() => setProfile((p) => ({ ...p, avatar: a }))}><Avatar id={a} size={36} /></button>
                    ))}
                  </div>
                  <details className="wp-reveal-prompt"><summary>How they will work</summary><pre>{profile.system_prompt}</pre></details>
                  {err ? <div className="wp-err" role="alert">{err}</div> : null}
                  <div className="wp-hire-acts">
                    <button type="button" className="uic-btn is-default is-md" onClick={() => { setStep('start'); setSid(''); setRounds(0); setProfile(null); }}><RefreshCw size={14} /> Start over</button>
                    <button type="button" className="uic-btn is-primary is-md" onClick={create} disabled={!cleanName(profile.name)}>Add {cleanName(profile.name)} to the workplace</button>
                  </div>
                </>
              )}
              {step === 'creating' && (
                <ol className="wp-progress" aria-live="polite">
                  {progress.map((p, i) => <li key={i} className={i === progress.length - 1 ? 'is-now' : 'is-done'}>{p}</li>)}
                </ol>
              )}
            </section>
          )}

          {step === 'error' && (
            <section className="wp-hire-card is-center">
              <div className="wp-err" role="alert">{err}</div>
              <div className="wp-hire-acts is-center"><button type="button" className="uic-btn is-primary is-md" onClick={retry}>Ask again</button><button type="button" className="uic-btn is-default is-md" onClick={() => { setStep('start'); setSid(''); setRounds(0); }}>Start over</button></div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
