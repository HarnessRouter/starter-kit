// Parsing pasted rows.
//
// This is how data gets into a sheet without spending a turn on it. Spreadsheets put TSV on the
// clipboard and CSV in files, so both are handled by the same parser with a guessed separator —
// guessing is safe here because the person SEES the parsed table before anything is imported.
import { uid } from './model';

/** The separator that yields the most consistent column count. */
function guessSep(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  if (!lines.length) return '\t';
  let best = '\t';
  let bestScore = -1;
  for (const sep of ['\t', ',', ';', '|']) {
    const counts = lines.map((l) => splitLine(l, sep).length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    const consistent = counts.filter((c) => c === max).length;
    const score = consistent * 10 + max;
    if (score > bestScore) { bestScore = score; best = sep; }
  }
  return best;
}

/** One line, honouring "quoted, fields" with doubled quotes inside. */
function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Text -> {header, rows} where header is the first line if it looks like labels. */
export function parseDelimited(text) {
  const sep = guessSep(text);
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { sep, header: [], rows: [] };
  const grid = lines.map((l) => splitLine(l, sep));
  const width = Math.max(...grid.map((r) => r.length));
  const padded = grid.map((r) => [...r, ...Array(width - r.length).fill('')]);
  // A first row of short, non-numeric, distinct strings is a header. Getting this wrong is
  // visible and reversible in the preview, so it is a guess worth making.
  const first = padded[0];
  const looksLikeHeader = padded.length > 1
    && first.every((c) => c === '' || (c.length <= 40 && Number.isNaN(Number(c))))
    && new Set(first.map((c) => c.toLowerCase())).size === first.length
    && first.some(Boolean);
  return {
    sep,
    header: looksLikeHeader ? first : first.map((_, i) => `Column ${i + 1}`),
    rows: looksLikeHeader ? padded.slice(1) : padded,
  };
}

/** Map incoming headers onto existing columns by name; the rest become new text columns. */
export function planImport(sheet, parsed) {
  const existing = sheet.columns || [];
  const mapping = parsed.header.map((h) => {
    const hit = existing.find((c) => c.name.trim().toLowerCase() === String(h).trim().toLowerCase());
    return { header: h, colId: hit?.id || null, newName: hit ? '' : String(h).trim() || 'Column' };
  });
  return { mapping, newColumns: mapping.filter((m) => !m.colId).length, rows: parsed.rows.length };
}

/** Apply an import. `mode` is 'append' or 'replace'; returns the next sheet. */
export function applyImport(sheet, parsed, mapping, mode) {
  const next = JSON.parse(JSON.stringify(sheet));
  next.columns = next.columns || [];
  next.rows = next.rows || [];
  next.cells = next.cells || {};

  const target = mapping.map((m) => {
    if (m.colId) return m.colId;
    const col = { id: uid('col'), name: m.newName || 'Column', type: 'text' };
    next.columns.push(col);
    return col.id;
  });

  if (mode === 'replace') {
    // Replacing rows drops their cells with them; the columns and their configuration stay,
    // which is what makes "paste a new batch into the same pipeline" one action.
    next.rows = [];
    next.cells = {};
  }

  for (const row of parsed.rows) {
    const rowId = uid('row');
    next.rows.push({ id: rowId });
    row.forEach((v, i) => {
      const colId = target[i];
      if (!colId || v === '') return;
      next.cells[`${rowId}:${colId}`] = { value: v };
    });
  }
  return next;
}
