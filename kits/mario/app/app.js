// The kit's page is a plain Unified Harness Protocol client, same-origin with the console's API
// proxy: start a run on this kit's harness, stream its items, show the frame the environment
// writes into the session's workspace. Every number shown comes from the server's own events.
const $ = (id) => document.getElementById(id);
const API = '/api/harness/v1';
const state = { harness: null, responseId: null, sessionId: null, controller: null, startedAt: 0, frameTimer: null };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function setStatus(text, cls) { const s = $('status'); s.textContent = text; s.className = 'pill' + (cls ? ' ' + cls : ''); }
function addStep(html, cls) {
  const list = $('steps');
  const li = document.createElement('li'); li.className = cls || ''; li.innerHTML = html; list.appendChild(li);
  while (list.children.length > 150) list.removeChild(list.firstChild);   // the last 150 items, the run goes on
  state.itemsTotal = (state.itemsTotal || 0) + 1;
  list.start = state.itemsTotal - list.children.length + 1;      // numbering continues past the trim
  const panel = list.closest('.panel');
  if (panel) panel.scrollTop = panel.scrollHeight;
}
let calls = 0;

async function harness() {
  if (state.harness) return state.harness;
  const r = await fetch(`${API}/harnesses`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`could not list harnesses (${r.status})`);
  const { harnesses = [] } = await r.json();
  state.harness = harnesses.find((h) => h.kit === 'mario') || null;
  if (!state.harness) throw new Error('Super Mario has not been launched yet. Open Starter Kits and launch it.');
  $('harnessName').textContent = state.harness.name || 'Super Mario';
  $('harnessModel').textContent = state.harness.defaultModel || state.harness.default_model || '';
  return state.harness;
}

function pollFrame() {
  if (!state.sessionId) return;
  const img = $('frame');
  const next = () => { state.frameTimer = setTimeout(pollFrame, 180); };
  const url = `${API}/sessions/${encodeURIComponent(state.sessionId)}/files/frame.jpg?t=${Date.now()}`;
  const probe = new Image();
  probe.onload = () => { img.src = probe.src; img.hidden = false; $('frameNote').hidden = true; next(); };
  probe.onerror = next;
  probe.src = url;
}
function stopFrames() { if (state.frameTimer) clearTimeout(state.frameTimer); state.frameTimer = null; }

async function start(previous) {
  const goal = $('goal').value.trim();
  if (!goal) { $('taskNote').textContent = 'Give the run a goal.'; return; }
  let h;
  try { h = await harness(); } catch (e) { $('taskNote').textContent = e.message; return; }
  const body = { input: goal, stream: true, metadata: { harness_id: h.id } };
  if (previous) body.previous_response_id = previous;
  $('steps').innerHTML = ''; $('final').hidden = true; $('traceMeta').textContent = ''; $('taskNote').textContent = '';
  $('startBtn').disabled = true; $('cancelBtn').hidden = false; $('continueBtn').hidden = true;
  setStatus('running', 'running');
  state.controller = new AbortController(); state.startedAt = performance.now(); state.itemsTotal = 0;
  calls = 0;
  try {
    const r = await fetch(`${API}/responses`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body), signal: state.controller.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          handle(ev);
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') { setStatus('failed', 'bad'); $('taskNote').textContent = e.message; }
  } finally {
    $('startBtn').disabled = false; $('cancelBtn').hidden = true;
    if (state.responseId) $('continueBtn').hidden = false;
    setTimeout(stopFrames, 1500);
  }

  function handle(ev) {
    const t = ev.type;
    if (t === 'response.created') {
      state.responseId = ev.response.id;
      const sid = ev.response.metadata?.session_id || null;
      if (sid && sid !== state.sessionId) { state.sessionId = sid; stopFrames(); pollFrame(); }
      $('traceTitle').textContent = `Steps · ${state.responseId.slice(0, 12)}…`;
      return;
    }
    if (t === 'response.output_item.done') {
      const it = ev.item; const ms = Math.round(performance.now() - state.startedAt);
      if (it.type === 'function_call') { calls += 1; addStep(`<span class="action">${esc(it.name)}(${esc(it.arguments)})</span> <span class="note">${ms} ms</span>`); }
      else if (it.type === 'function_call_output') addStep(`<span class="result">${esc(it.output)}</span>`);
      else if (it.type === 'reasoning') addStep(`<span class="reason">${esc((it.summary || [])[0]?.text || '')}</span>`);
      else if (it.type === 'message') { $('final').textContent = (it.content || [])[0]?.text || ''; $('final').hidden = false; }
      return;
    }
    if (t === 'response.completed' || t === 'response.incomplete' || t === 'response.failed') {
      const r = ev.response; const u = r.usage; const secs = ((performance.now() - state.startedAt) / 1000).toFixed(1);
      setStatus(r.status + (r.incomplete_details?.reason ? `: ${r.incomplete_details.reason}` : ''), r.status === 'completed' ? 'ok' : 'bad');
      $('traceMeta').textContent = `${calls} action${calls === 1 ? '' : 's'} · ${secs} s` + (u ? ` · ${u.input_tokens} in / ${u.output_tokens} out` : '') + (r.model ? ` · ${r.model}` : '');
      if (r.error) $('taskNote').textContent = r.error.message || JSON.stringify(r.error);
    }
  }
}

async function cancel() {
  if (!state.responseId) return;
  try { await fetch(`${API}/responses/${encodeURIComponent(state.responseId)}/cancel`, { method: 'POST' }); } catch {}
}

$('startBtn').addEventListener('click', () => start(null));
$('continueBtn').addEventListener('click', () => start(state.responseId));
$('cancelBtn').addEventListener('click', cancel);
harness().catch((e) => { $('taskNote').textContent = e.message; });
