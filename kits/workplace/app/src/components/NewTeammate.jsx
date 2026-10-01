// Hiring. First the look and the name, the way you would set up a new contact: a big face, a row
// of colours, a row of shapes, a name, one sentence about the job, Get started. Then the recruiter
// asks a few questions, drawn as pills, and the profile appears for a last look before the
// teammate joins. The recruiter runs on a session of its own per hire.
import React, { useCallback, useRef, useState } from 'react';
import { Menu, RefreshCw } from 'lucide-react';
import { streamTurn } from 'reifyui/harness';
import { useWorkplace } from '../App.jsx';
import { Avatar, Blob, COLORS, COLOR_IDS, SHAPES, SHAPE_LABELS, DEFAULT_AVATAR } from '../lib/avatars.jsx';
import { NAME_MAX, OTHER, answersToText, cleanName, parseBuilderReply } from '../lib/builder.js';
import { createTeammate } from '../lib/teammates.js';

const SUGGESTIONS = [
  { title: 'Research analyst', text: 'Reads everything first and comes back with a short brief and its sources', look: { shape: 'drop', color: 'orange' } },
  { title: 'Release notes', text: 'Turns your bullet points into release notes in your voice', look: { shape: 'hex', color: 'purple' } },
  { title: 'Data wrangler', text: 'Cleans messy spreadsheets and charts what matters as PNG files', look: { shape: 'square', color: 'blue' } },
  { title: 'Week planner', text: 'Keeps your week straight and checks in before it commits you', look: { shape: 'cloud', color: 'green' } },
];
const MAX_ROUNDS = 3;

function Slow({ since }) {
  const [now, setNow] = useState(Date.now());
  React.useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const s = since ? Math.floor((now - since) / 1000) : 0;
  if (s < 40) return null;
  return <p className="wp-hire-slow">Still working after {s} s. A first answer usually takes under half a minute.</p>;
}

export default function NewTeammate({ first = false }) {
  const { me, rec, teammates, navigate, refreshTeammates, openDrawer } = useWorkplace();
  const taken = (teammates || []).map((t) => t.name);
  const nameTaken = (n) => taken.some((x) => x.toLowerCase() === cleanName(n).toLowerCase());
  const [step, setStep] = useState('start');       // start | thinking | asking | reveal | creating | error
  const [look, setLook] = useState(DEFAULT_AVATAR);
  const [givenName, setGivenName] = useState('');
  const [need, setNeed] = useState('');
  const [sid, setSid] = useState('');
  const [qset, setQset] = useState(null);
  const [answers, setAnswers] = useState({});
  const [rounds, setRounds] = useState(0);
  const [profile, setProfile] = useState(null);
  const [progress, setProgress] = useState([]);
  const [err, setErr] = useState('');
  const [thinkingSince, setThinkingSince] = useState(0);
  const textRef = useRef('');

  const RESEND = 'Your last reply was not one valid JSON object. Send the same answer again as exactly one JSON object and nothing else. It ended with:';
  const ask = useCallback(async (input) => {
    setStep('thinking'); setErr(''); setThinkingSince(Date.now());
    textRef.current = '';
    let r;
    try {
      // The recruiter does not see the roster: it is told which names are taken, or two
      // teammates end up with one name and one @handle (a fourth hire was a second Marlowe).
      r = await streamTurn({ sessionId: sid, harnessId: rec.id, input,
        instructions: taken.length ? `Names already used in this workplace, never reuse any of them: ${taken.join(', ')}.` : undefined,
        handlers: { onSession: (id) => setSid(id), onTextDelta: (d) => { textRef.current += d; }, onError: (m) => setErr(String(m || '')) } });
    } catch (e) { setErr(e?.message || 'The recruiter did not answer.'); setStep('error'); return; }
    if (r?.connecting) { setErr('Still connecting. Try again in a moment.'); setStep('error'); return; }
    let parsed = parseBuilderReply(textRef.current);
    if (!parsed && !input.startsWith(RESEND)) {
      // One silent retry: the recruiter is asked for the same object again before the person
      // sees an error. The reply is usually a slip a model makes once.
      return ask(`${RESEND} ${textRef.current.slice(-80)}`);
    }
    if (!parsed) { setErr('The recruiter answered in a form this page cannot draw. Ask again.'); setStep('error'); return; }
    if (parsed.type === 'teammate') { setProfile({ ...parsed, name: cleanName(givenName) !== 'Teammate' ? cleanName(givenName) : parsed.name }); setStep('reveal'); return; }
    setQset(parsed); setAnswers({}); setRounds((n) => n + 1); setStep('asking');
  }, [sid, rec, givenName, taken.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const startWith = (text, name = givenName) => {
    const parts = [];
    if (name.trim()) parts.push(`Their name is ${cleanName(name)}.`);
    if (text.trim()) parts.push(`I need a teammate: ${text.trim()}`);
    ask(parts.length ? parts.join(' ') : 'start');
  };
  const start = () => startWith(need);
  const suggest = (s) => { setLook(s.look); setNeed(s.text); startWith(s.text); };
  const submitAnswers = () => {
    const text = answersToText(qset.questions, answers);
    ask(rounds >= MAX_ROUNDS - 1 ? `${text}\n\nThat is enough; write the profile now.` : text);
  };
  const retry = () => ask(sid ? 'Please answer again with only the JSON object described in your Skill.' : 'start');
  const reset = () => { setStep('start'); setSid(''); setRounds(0); setProfile(null); setErr(''); };

  const toggle = (q, opt) => setAnswers((a) => {
    const cur = a[q.id] || { picked: [], other: '' };
    const picked = q.multiple ? (cur.picked.includes(opt) ? cur.picked.filter((x) => x !== opt) : [...cur.picked, opt]) : (cur.picked[0] === opt ? [] : [opt]);
    return { ...a, [q.id]: { ...cur, picked, otherOn: q.multiple ? cur.otherOn : false } };
  });
  const toggleOther = (q) => setAnswers((a) => { const cur = a[q.id] || { picked: [], other: '' }; return { ...a, [q.id]: { ...cur, otherOn: !cur.otherOn, picked: q.multiple ? cur.picked : [] } }; });
  // One answer is enough to go on: the recruiter is told which questions were left open and
  // decides for itself. A Continue that stayed grey until every question was answered read as
  // a page that did not work (Richard, 2026-09-30).
  const answeredN = qset ? qset.questions.filter((q) => { const a = answers[q.id]; return a && (a.picked.length || (a.otherOn && a.other.trim())); }).length : 0;
  const answered = answeredN > 0;

  const create = async () => {
    if (nameTaken(profile.name)) { setErr(`There is already a teammate called ${cleanName(profile.name)}. Give this one another name.`); return; }
    setStep('creating'); setProgress([]); setErr('');
    try {
      const { teammate } = await createTeammate({ ...profile, avatar: look }, me, (s) => setProgress((p) => [...p, s]));
      setProgress((p) => [...p, `${teammate.name} joined`]);
      await refreshTeammates();
      navigate(`dm/${teammate.id}`, true);
    } catch (e) { setErr(e?.message || 'The teammate could not be created.'); setStep('reveal'); }
  };

  const face = (
    <div className="wp-look">
      <div className="wp-look-big"><Blob shape={look.shape} color={look.color} size={96} /></div>
      <div className="wp-look-colors" role="radiogroup" aria-label="Colour">
        {COLOR_IDS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={look.color === c} aria-label={c} className={`wp-dot${look.color === c ? ' is-on' : ''}`} style={{ '--dot': COLORS[c] }} onClick={() => setLook((l) => ({ ...l, color: c }))} />
        ))}
      </div>
      <div className="wp-look-shapes" role="radiogroup" aria-label="Shape">
        {SHAPES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={look.shape === s} title={SHAPE_LABELS[s]} className={`wp-shape${look.shape === s ? ' is-on' : ''}`} onClick={() => setLook((l) => ({ ...l, shape: s }))}><Blob shape={s} color={look.color} size={26} /></button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="wp-page">
      <header className="wp-head is-page">
        <button type="button" className="wp-iconbtn wp-menubtn" onClick={openDrawer} aria-label="Rooms"><Menu size={20} /></button>
        <Avatar avatar={look} size={22} />
        <div className="wp-head-titles"><h1 className="wp-head-title">{step === 'start' ? 'New teammate' : cleanName(givenName) !== 'Teammate' ? cleanName(givenName) : profile?.name || 'New teammate'}</h1></div>
      </header>
      <div className="wp-page-scroll">
        <div className="wp-hire">
          {step === 'start' && (
            <>
              {first ? <p className="wp-hire-hello">Nobody works here yet. Pick a face, say what you need, and the recruiter takes it from there.</p> : null}
              {face}
              <div className="wp-hire-fields">
                <label className="wp-hire-label" htmlFor="tm-name">Name <span>optional</span></label>
                <input id="tm-name" className="wp-hire-input" value={givenName} maxLength={NAME_MAX} placeholder="New teammate" onChange={(e) => setGivenName(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } }} />
                <label className="wp-hire-label" htmlFor="need">What should they do for you? <span>optional</span></label>
                <textarea id="need" className="wp-hire-input" rows={2} value={need} onChange={(e) => setNeed(e.target.value)} placeholder="e.g. keep an eye on competitor pricing and tell me what changed"
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); start(); } }} />
                <button type="button" className="wp-btn is-primary is-lg" onClick={start}>Get started</button>
              </div>
              <div className="wp-sugg-h">Suggestions</div>
              <div className="wp-sugg">
                {SUGGESTIONS.map((s) => (
                  <button key={s.title} type="button" className="wp-sugg-card" onClick={() => suggest(s)}>
                    <Blob shape={s.look.shape} color={s.look.color} size={44} />
                    <span className="wp-sugg-body"><span className="wp-sugg-title">{s.title}</span><span className="wp-sugg-text">{s.text}</span></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 'thinking' && (
            <div className="wp-hire-center">
              <span className="wp-bob"><Blob shape={look.shape} color={look.color} size={72} /></span>
              <p className="wp-hire-thinking">The recruiter is thinking{rounds ? ' about your answers' : ''}…</p>
              <Slow since={thinkingSince} />
            </div>
          )}

          {step === 'asking' && qset && (
            <div className="wp-hire-card is-ask">
              {qset.intro ? <p className="wp-hire-intro">{qset.intro}</p> : null}
              <div className="wp-qs">
              {qset.questions.map((q, qi) => {
                const a = answers[q.id] || { picked: [], other: '', otherOn: false };
                return (
                  <div key={q.id} className="wp-q" role="group" aria-labelledby={`q-${q.id}`}>
                    <div className="wp-q-prompt" id={`q-${q.id}`}><span className="wp-q-n">{qi + 1}</span>{q.prompt}{q.multiple ? <span className="wp-q-multi">pick any</span> : null}</div>
                    <div className="wp-q-opts" role={q.multiple ? 'group' : 'radiogroup'}>
                      {q.options.map((o) => (
                        <button key={o} type="button" role={q.multiple ? 'checkbox' : 'radio'} aria-checked={a.picked.includes(o)} className={`wp-opt${a.picked.includes(o) ? ' is-on' : ''}`} onClick={() => toggle(q, o)}>{o}</button>
                      ))}
                      <button type="button" role={q.multiple ? 'checkbox' : 'radio'} aria-checked={!!a.otherOn} className={`wp-opt is-other${a.otherOn ? ' is-on' : ''}`} onClick={() => toggleOther(q)}>{OTHER}…</button>
                    </div>
                    {a.otherOn ? <input className="wp-hire-input is-sm" value={a.other} autoFocus placeholder="Say it in your words" onChange={(e) => setAnswers((x) => ({ ...x, [q.id]: { ...a, other: e.target.value } }))} /> : null}
                  </div>
                );
              })}
              </div>
              <div className="wp-hire-acts">
                <span className="wp-hire-step">{answered ? `${answeredN} of ${qset.questions.length} answered` : 'Pick at least one answer'} · round {rounds} of {MAX_ROUNDS}</span>
                <button type="button" className="wp-btn is-primary" onClick={submitAnswers} disabled={!answered}>Continue</button>
              </div>
            </div>
          )}

          {(step === 'reveal' || step === 'creating') && profile && (
            <div className="wp-hire-card is-reveal">
              <div className="wp-reveal-top">
                <Blob shape={look.shape} color={look.color} size={80} />
                <div className="wp-reveal-id">
                  <input className="wp-reveal-name" value={profile.name} maxLength={NAME_MAX} aria-label="Name" disabled={step === 'creating'}
                         onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} onBlur={() => setProfile((p) => ({ ...p, name: cleanName(p.name) }))} />
                  <input className="wp-reveal-tag" value={profile.tagline} maxLength={60} aria-label="Tagline" disabled={step === 'creating'} onChange={(e) => setProfile((p) => ({ ...p, tagline: e.target.value }))} />
                  {profile.expertise.length ? <div className="wp-tags">{profile.expertise.map((e) => <span key={e} className="wp-tag">{e}</span>)}</div> : null}
                </div>
              </div>
              {profile.greeting ? <div className="wp-reveal-greeting"><span className="wp-b-bubble">{profile.greeting}</span></div> : null}
              {step === 'reveal' && (
                <>
                  {face}
                  <details className="wp-reveal-prompt"><summary>How they will work</summary><pre>{profile.system_prompt}</pre></details>
                  {err ? <div className="wp-err" role="alert">{err}</div> : null}
                  <div className="wp-hire-acts">
                    <button type="button" className="wp-btn" onClick={reset}><RefreshCw size={14} /> Start over</button>
                    <button type="button" className="wp-btn is-primary" onClick={create} disabled={!cleanName(profile.name)}>Add {cleanName(profile.name)} to the workplace</button>
                  </div>
                </>
              )}
              {step === 'creating' && (
                <ol className="wp-progress" aria-live="polite">{progress.map((p, i) => <li key={i} className={i === progress.length - 1 ? 'is-now' : 'is-done'}>{p}</li>)}</ol>
              )}
            </div>
          )}

          {step === 'error' && (
            <div className="wp-hire-center">
              <div className="wp-err" role="alert">{err}</div>
              <div className="wp-hire-acts is-center"><button type="button" className="wp-btn is-primary" onClick={retry}>Ask again</button><button type="button" className="wp-btn" onClick={reset}>Start over</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
