// Configuring an agent column: which agent runs, what it is asked, and what it is given.
//
// Rendered inside the grid's own column popover (SheetGrid's renderColumnConfig slot), so it sits
// under the Type select where a column's settings already live.
//
// The picker never lists this sheet's own agent — that exclusion happens in sh.js, at the source
// of the list, so the recursive choice is not offered rather than offered and then refused.
import { useEffect, useMemo, useRef, useState } from 'react';
import { columnByName, derivedDeps, isHarnessColumn, refs } from '../lib/model';
import { runnableHarnesses } from '../lib/sh';

export function HarnessConfig({ column, columns, applyPatch, close }) {
  const index = columns.findIndex((c) => c.id === column.id);
  // Only columns to the LEFT can be referenced. Enforced here so a forward reference cannot be
  // authored in the first place — the planner re-checks, but a refusal at run time is a worse
  // place to learn it.
  const earlier = useMemo(() => columns.slice(0, index < 0 ? columns.length : index), [columns, index]);
  const attachable = earlier.filter(isHarnessColumn);

  const cfg = column.harness || {};
  const [harnessId, setHarnessId] = useState(cfg.harness_id || '');
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [attach, setAttach] = useState(new Set(cfg.attach || []));
  const [agents, setAgents] = useState(null);       // null = still loading
  const [loadErr, setLoadErr] = useState('');
  const promptRef = useRef(null);

  useEffect(() => {
    let dead = false;
    runnableHarnesses()
      .then((list) => { if (!dead) setAgents(list); })
      .catch((e) => { if (!dead) { setAgents([]); setLoadErr(e?.message || 'Could not load your agents.'); } });
    return () => { dead = true; };
  }, []);

  const chosen = agents?.find((a) => a.id === harnessId) || null;

  // What this column will actually read, derived from the prompt and the attachments — the same
  // function the planner uses, so what is shown and what runs cannot drift apart.
  const reads = derivedDeps({ ...column, type: 'harness', harness: { prompt, attach: [...attach] } }, columns)
    .map((id) => columns.find((c) => c.id === id)?.name)
    .filter(Boolean);

  // A reference that names no column, or one that is not to the left. Shown while typing rather
  // than at run time.
  const badRefs = refs(prompt).filter((n) => {
    const hit = columnByName(columns, n);
    return !hit || columns.indexOf(hit) >= index;
  });

  const insertRef = (name) => {
    const el = promptRef.current;
    const token = `{{${name}}}`;
    if (!el) { setPrompt((p) => p + token); return; }
    const { selectionStart: a, selectionEnd: b } = el;
    setPrompt((p) => p.slice(0, a) + token + p.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };

  const toggleAttach = (id) => setAttach((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const save = () => applyPatch({
    harness: {
      harness_id: harnessId,
      harness_name: chosen?.name || cfg.harness_name || '',
      prompt,
      attach: [...attach].filter((id) => attachable.some((c) => c.id === id)),
      ...(cfg.timeout_seconds ? { timeout_seconds: cfg.timeout_seconds } : {}),
    },
  });

  return (
    <div className="hc">
      <label className="shg-menu-lbl">Agent
        {agents === null ? (
          <div className="hc-note">Loading your agents…</div>
        ) : agents.length === 0 ? (
          <div className="hc-note">
            {loadErr || 'You have no other agents yet. Create one, then choose it here.'}
          </div>
        ) : (
          <select className="shg-menu-input" value={harnessId}
                  onChange={(e) => setHarnessId(e.target.value)}>
            <option value="">Choose an agent…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!!a.unusable}>
                {a.name}{a.model ? ` · ${a.model}` : ''}{a.unusable ? ` — ${a.unusable}` : ''}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="shg-menu-lbl">Ask it
        <textarea ref={promptRef} className="shg-menu-input hc-prompt" rows={5} value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={'Write one sentence about {{Company}}.'} />
      </label>

      {earlier.length > 0 && (
        <div className="hc-chips">
          <span className="hc-chips-lbl">Insert</span>
          {earlier.map((c) => (
            <button key={c.id} type="button" className="hc-chip" onClick={() => insertRef(c.name)}>
              {`{{${c.name}}}`}
            </button>
          ))}
        </div>
      )}
      {!earlier.length && (
        <div className="hc-note">
          This is the first column, so there is nothing to its left to reference yet. Every row will
          get the same question.
        </div>
      )}

      {badRefs.length > 0 && (
        <div className="hc-bad">
          {badRefs.map((n) => `{{${n}}}`).join(', ')} {badRefs.length > 1 ? 'do not name columns' : 'does not name a column'} to
          the left of this one, so the run would be refused.
        </div>
      )}

      {attachable.length > 0 && (
        <div className="shg-menu-lbl">Also attach the files from
          <div className="shg-menu-deps">
            {attachable.map((c) => (
              <label key={c.id} className="shg-menu-dep">
                <input type="checkbox" checked={attach.has(c.id)} onChange={() => toggleAttach(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="hc-reads">
        {reads.length ? <>Reads <b>{reads.join(', ')}</b> — once per row.</>
                      : 'Reads nothing from this sheet yet.'}
      </div>

      <div className="shg-menu-actions">
        <button className="shg-pop-clear" onClick={close}>Cancel</button>
        <button className="shg-menu-apply" onClick={save}>Save</button>
      </div>
    </div>
  );
}
