// The sheet document, as data — no React, no network, no DOM.
//
// One file describes a sheet: ./sheet.json in the sheet session's workspace. Both the app and the
// agent write it, so its rules have to be stated somewhere both can be checked against. They are
// stated here, and mirrored in skills/sheet-design/validate_sheet.py for the agent. If the two
// ever disagree, this file is right and the validator is the bug.
//
//   { meta:    { schema: 1, title }
//     columns: [ {id, name, type, width?, options?, harness?} ]   ORDER IS DEPENDENCY ORDER
//     rows:    [ {id, height?} ]
//     cells:   { "<rowId>:<colId>": {...} }                       sparse
//     run:     {...} }                                            the last run, and only the last
//
// The one structural rule everything else rests on: an agent column may only read columns
// EARLIER in `columns`. That makes the array a topological order by construction, which is why
// there is no sort anywhere in this kit and no cycle to handle.

export const SCHEMA = 1;

export const COLUMN_TYPES = ['text', 'number', 'select', 'tags', 'checkbox', 'date', 'url', 'harness'];

export const TYPE_LABEL = {
  text: 'Text', number: 'Number', select: 'Select', tags: 'Tags',
  checkbox: 'Checkbox', date: 'Date', url: 'Link', harness: 'Agent',
};

/** The same list, as the grid's column vocabulary — plain data, no React.
 *
 *  It lives beside the types themselves because TWO surfaces render a sheet: the editor and the
 *  template preview on the landing page. A second copy is how the preview ends up labelling an
 *  agent column "harness".
 *
 *  `harness` is a first-class type rather than a discriminator over a generic "computed" kind:
 *  the other kinds the hosted product offered (a workflow, an image) have no engine behind them
 *  here, and a discriminator with one member is a fallback waiting to accrete. */
export const GRID_TYPES = [
  { type: 'text', label: TYPE_LABEL.text },
  { type: 'number', label: TYPE_LABEL.number },
  { type: 'select', label: TYPE_LABEL.select },
  { type: 'tags', label: TYPE_LABEL.tags },
  { type: 'checkbox', label: TYPE_LABEL.checkbox },
  { type: 'date', label: TYPE_LABEL.date },
  { type: 'url', label: TYPE_LABEL.url },
  {
    type: 'harness',
    label: TYPE_LABEL.harness,
    computed: true,
    configKey: 'harness',
    badge: (col) => col.harness?.harness_name || (col.harness?.harness_id ? '' : 'not set up'),
    configWidth: 380,
    configHeight: 460,
  },
];

/** The five states an agent cell can be in. An unrun cell is an ABSENT key, not a sixth state:
 *  one representation per fact. */
export const CELL_STATUS = ['queued', 'running', 'done', 'failed', 'skipped'];

/** The agent's answer is capped in the document. The grid deep-clones the whole sheet on every
 *  edit and the workspace write has a hard byte cap, so forty rows of unbounded model output
 *  would eventually refuse to save. Nothing is lost: the untruncated text is one request away and
 *  the cell drawer shows it. */
export const VALUE_MAX = 4000;

export const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
export const cellKey = (rowId, colId) => `${rowId}:${colId}`;

export const isHarnessColumn = (col) => col?.type === 'harness';

export function columnByName(columns, name) {
  const want = String(name || '').trim().toLowerCase();
  return (columns || []).find((c) => String(c.name || '').trim().toLowerCase() === want) || null;
}

/** The {{Name}} references in a prompt, in order, de-duplicated.
 *
 *  The pattern matches the hosted product's exactly, so a prompt written there means the same
 *  thing here. */
export function refs(prompt) {
  const out = [];
  for (const m of String(prompt || '').matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Which columns an agent column reads: the union of its prompt references and its attachments.
 *
 *  Derived, never stored. The hosted product stored a `deps` array, validated it, rendered a
 *  checkbox list for it — and ignored it at execution. Two declarations of one fact, and the one
 *  the person could see was the one that did nothing. The config that feeds the turn is the only
 *  source of truth about what the turn reads. */
export function derivedDeps(col, columns) {
  if (!isHarnessColumn(col)) return [];
  const h = col.harness || {};
  const ids = [];
  for (const name of refs(h.prompt)) {
    const hit = columnByName(columns, name);
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  for (const id of h.attach || []) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/** What one cell is worth as text — for interpolation, for export, and for a downstream prompt. */
export function cellText(cell, col) {
  const v = cell?.value;
  if (v === undefined || v === null) return '';
  switch (col?.type) {
    case 'tags':
      return Array.isArray(v) ? v.join(', ') : String(v);
    case 'checkbox':
      return v ? 'yes' : 'no';
    default:
      if (Array.isArray(v)) return v.join(', ');
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
  }
}

/** Substitute {{Name}} for this row's values.
 *
 *  `values` maps column id -> text. A reference whose column has no value in this row is NOT
 *  silently blanked: it is reported, so the caller can skip that one cell with a reason instead
 *  of sending the model a prompt with a hole in it. The hosted product substituted empty, which
 *  fabricates input and produces a confident answer about nothing. */
export function interpolate(prompt, columns, values) {
  const missing = [];
  const text = String(prompt || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, name) => {
    const col = columnByName(columns, name);
    if (!col) return whole;                       // a config error; the planner refuses first
    const v = values[col.id];
    if (v === undefined || v === null || v === '') {
      if (!missing.includes(col.name)) missing.push(col.name);   // named once, however often used
      return '';
    }
    return v;
  });
  return { text, missing };
}

export function blankSheet(title = 'Untitled sheet') {
  const cols = [
    { id: uid('col'), name: 'Item', type: 'text', width: 220 },
    { id: uid('col'), name: 'Notes', type: 'text', width: 320 },
  ];
  return {
    meta: { schema: SCHEMA, title },
    columns: cols,
    rows: [{ id: uid('row') }, { id: uid('row') }, { id: uid('row') }],
    cells: {},
  };
}

/** A fresh copy of a template, with new ids.
 *
 *  Templates ship with placeholder ids; materialising them per sheet keeps two sheets made from
 *  one template from sharing a cell key. */
export function materialize(template, title) {
  const colId = {};
  const rowId = {};
  const columns = (template.columns || []).map((c) => {
    const id = uid('col');
    colId[c.id] = id;
    return { ...c, id };
  });
  // attach[] holds column ids, so it has to be remapped with everything else.
  for (const c of columns) {
    if (c.harness?.attach) c.harness = { ...c.harness, attach: c.harness.attach.map((a) => colId[a]).filter(Boolean) };
  }
  const rows = (template.rows || []).map((r) => {
    const id = uid('row');
    rowId[r.id] = id;
    return { ...r, id };
  });
  const cells = {};
  for (const [k, v] of Object.entries(template.cells || {})) {
    const [r, c] = k.split(':');
    if (rowId[r] && colId[c]) cells[cellKey(rowId[r], colId[c])] = v;
  }
  return {
    meta: { schema: SCHEMA, title: title || template.meta?.title || template.name || 'Untitled sheet' },
    columns, rows, cells,
  };
}

const CHRN = /^chrn_[0-9a-f]{32}$/;
const APP_OWNED = ['status', 'run_id', 'response_id', 'session_id', 'artifacts', 'started_at', 'ended_at'];

/** Every way a sheet can be wrong, with the fix for each.
 *
 *  Errors are things that make the sheet render or run incorrectly; warnings are things that are
 *  merely suspect. Returns {errors, warnings} of {where, what, fix}. */
export function validate(sheet) {
  const errors = [];
  const warnings = [];
  const err = (where, what, fix) => errors.push({ where, what, fix });
  const warn = (where, what, fix) => warnings.push({ where, what, fix });

  if (!sheet || typeof sheet !== 'object') {
    err('sheet.json', 'the file is not a JSON object', 'Write an object with meta, columns, rows and cells.');
    return { errors, warnings };
  }
  if (sheet.meta?.schema !== SCHEMA) {
    err('meta.schema', `is ${JSON.stringify(sheet.meta?.schema)}, not ${SCHEMA}`,
        `Set "schema": ${SCHEMA}. The app refuses anything else rather than guessing.`);
  }

  const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  if (!Array.isArray(sheet.columns)) err('columns', 'is missing or not an array', 'Write "columns": [].');
  if (!Array.isArray(sheet.rows)) err('rows', 'is missing or not an array', 'Write "rows": [].');

  const seenCol = new Set();
  const seenName = new Set();
  columns.forEach((c, i) => {
    const at = `columns[${i}]`;
    if (!c?.id) err(at, 'has no id', 'Give it a stable id like "col_a1b2c3d4".');
    else if (seenCol.has(c.id)) err(at, `repeats the id "${c.id}"`, 'Ids must be unique.');
    else seenCol.add(c.id);

    const name = String(c?.name || '').trim();
    if (!name) err(at, 'has no name', 'Every column needs a short, human name.');
    else if (seenName.has(name.toLowerCase())) {
      err(at, `repeats the name "${name}"`,
          'Column names must be unique: agent prompts address columns as {{Name}}, and a duplicate makes that ambiguous.');
    } else seenName.add(name.toLowerCase());

    if (!COLUMN_TYPES.includes(c?.type)) {
      err(at, `has type ${JSON.stringify(c?.type)}`, `Use one of: ${COLUMN_TYPES.join(' ')}.`);
    }
    if (isHarnessColumn(c) && !c.harness) {
      err(at, 'is an agent column with no "harness" object',
          'Add "harness": { "harness_id": "", "prompt": "…", "attach": [] }.');
    }
    if (!isHarnessColumn(c) && c?.harness) {
      err(at, 'carries a "harness" object but is not an agent column',
          'Either set "type": "harness" or delete the harness object.');
    }
    if (isHarnessColumn(c) && c.harness) {
      const hid = c.harness.harness_id;
      if (hid !== '' && hid !== undefined && !CHRN.test(String(hid))) {
        err(`${at}.harness.harness_id`, `is ${JSON.stringify(hid)}`,
            'Leave it "" unless you were given a real agent id — you cannot see the list of agents.');
      }
      const prompt = String(c.harness.prompt || '');
      if (!prompt.trim()) {
        err(`${at}.harness.prompt`, 'is empty', 'An agent column needs a prompt; it is what runs on every row.');
      } else if (!refs(prompt).length) {
        warn(`${at}.harness.prompt`, 'references no columns',
             'Without a {{Column}} reference every row gets the same input, so every row gets the same answer.');
      }
      for (const name of refs(prompt)) {
        const hit = columnByName(columns, name);
        if (!hit) {
          err(`${at}.harness.prompt`, `references {{${name}}}, which is not a column`,
              `Use one of: ${columns.map((x) => x.name).filter(Boolean).join(', ') || '(none)'}.`);
        } else if (columns.indexOf(hit) >= i) {
          err(`${at}.harness.prompt`, `references {{${name}}}, which is not to its left`,
              `Move "${hit.name}" before "${c.name}". A column can only read columns earlier in the sheet.`);
        }
      }
      for (const a of c.harness.attach || []) {
        const hit = columns.find((x) => x.id === a);
        if (!hit) err(`${at}.harness.attach`, `names "${a}", which is not a column`, 'Attach only real column ids.');
        else if (columns.indexOf(hit) >= i) {
          err(`${at}.harness.attach`, `attaches "${hit.name}", which is not to its left`,
              'A column can only attach files from columns earlier in the sheet.');
        } else if (!isHarnessColumn(hit)) {
          err(`${at}.harness.attach`, `attaches "${hit.name}", which is not an agent column`,
              'Only agent columns produce files. Reference a plain column as {{Name}} instead.');
        }
      }
    }
    if ((c?.type === 'select' || c?.type === 'tags') && c.options && !Array.isArray(c.options)) {
      err(`${at}.options`, 'is not an array', 'Write "options": ["Todo", "Doing", "Done"].');
    }
  });

  const seenRow = new Set();
  rows.forEach((r, i) => {
    if (!r?.id) err(`rows[${i}]`, 'has no id', 'Give it a stable id like "row_a1b2c3d4".');
    else if (seenRow.has(r.id)) err(`rows[${i}]`, `repeats the id "${r.id}"`, 'Ids must be unique.');
    else seenRow.add(r.id);
  });

  const cells = (sheet.cells && typeof sheet.cells === 'object') ? sheet.cells : {};
  if (sheet.cells && typeof sheet.cells !== 'object') {
    err('cells', 'is not an object', 'Write "cells": { "<rowId>:<colId>": { "value": … } }.');
  }
  for (const [k, cell] of Object.entries(cells)) {
    const [rowRef, colRef, extra] = k.split(':');
    if (extra !== undefined || !rowRef || !colRef) {
      err(`cells["${k}"]`, 'is not a "<rowId>:<colId>" key', 'Join the row id and the column id with one colon.');
      continue;
    }
    if (!seenRow.has(rowRef)) err(`cells["${k}"]`, `names row "${rowRef}", which does not exist`, 'Use an id from rows[].');
    const col = columns.find((c) => c.id === colRef);
    if (!col) {
      err(`cells["${k}"]`, `names column "${colRef}", which does not exist`,
          'Use an id from columns[] — a column NAME here renders nothing.');
      continue;
    }
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
      err(`cells["${k}"]`, 'is not an object', 'Write { "value": … } — never a bare value at the key.');
      continue;
    }
    if (!isHarnessColumn(col)) {
      const owned = APP_OWNED.filter((f) => f in cell);
      if (owned.length) {
        err(`cells["${k}"]`, `carries ${owned.join(', ')} in a plain column`,
            'Only agent cells carry run state, and only the app writes it.');
      }
    } else {
      if (cell.status !== undefined && !CELL_STATUS.includes(cell.status)) {
        err(`cells["${k}"].status`, `is ${JSON.stringify(cell.status)}`, `Use one of: ${CELL_STATUS.join(' ')}.`);
      }
      // A cell that was never dispatched belongs to a run without having a session — that is
      // what `skipped` means, and it is written by the app itself. Only a cell that claims to
      // have RUN needs both halves of the reference.
      const ran = ['running', 'done', 'failed'].includes(cell.status);
      if (ran && Boolean(cell.run_id) !== Boolean(cell.session_id)) {
        err(`cells["${k}"]`, 'claims to have run but has only one of run_id / session_id',
            'Both come from a real run. Delete them, or leave the cell out entirely.');
      }
    }
    if (col.type === 'checkbox' && cell.value !== undefined && typeof cell.value !== 'boolean') {
      warn(`cells["${k}"]`, 'is a checkbox holding a non-boolean', 'Write true or false.');
    }
    if (col.type === 'number' && cell.value !== undefined && cell.value !== null
        && typeof cell.value !== 'number') {
      warn(`cells["${k}"]`, 'is a number column holding a non-number', 'Write the value as a number, not a string.');
    }
    if ((col.type === 'select' || col.type === 'tags') && Array.isArray(col.options) && col.options.length) {
      const vals = col.type === 'tags'
        ? (Array.isArray(cell.value) ? cell.value : [])
        : (cell.value == null || cell.value === '' ? [] : [cell.value]);
      for (const v of vals) {
        if (!col.options.some((o) => (typeof o === 'string' ? o : o?.label) === v)) {
          warn(`cells["${k}"]`, `holds "${v}", which is not one of the column's options`,
               'Add it to options, or use one of the existing ones.');
        }
      }
    }
  }

  if (sheet.run) {
    for (const id of sheet.run.columns || []) {
      if (!columns.some((c) => c.id === id)) {
        warn('run.columns', `names column "${id}", which no longer exists`,
             'Leave it — the run header simply counts one column fewer.');
      }
    }
  }

  return { errors, warnings };
}
