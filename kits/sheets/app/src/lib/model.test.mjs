// The document rules, pinned. `node --test src/lib/`
//
// These are the rules an agent gets wrong, so they are the ones worth a test: a reference to a
// column that is not to the left, two columns with the same name, run state written into a cell
// nobody ran, a cells key holding a column NAME instead of an id.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cellKey, cellText, columnByName, derivedDeps, interpolate, materialize, refs, validate,
} from './model.js';

function sheet(columns, rows = [{ id: 'row_1' }], cells = {}) {
  return { meta: { schema: 1, title: 'T' }, columns, rows, cells };
}
const errorsOf = (s) => validate(s).errors.map((e) => `${e.where}: ${e.what}`);
const col = (id, name, type = 'text', extra = {}) => ({ id, name, type, ...extra });
const agent = (id, name, prompt, attach = []) =>
  col(id, name, 'harness', { harness: { harness_id: '', prompt, attach } });

test('refs finds every {{Name}} once, trimmed, in order', () => {
  assert.deepEqual(refs('Read {{ Site }} about {{Company}} and {{Site}} again'), ['Site', 'Company']);
  assert.deepEqual(refs(''), []);
  assert.deepEqual(refs(null), []);
});

test('columnByName is case- and space-insensitive, because people type headers', () => {
  const cols = [col('c1', 'Company Name')];
  assert.equal(columnByName(cols, ' company name ')?.id, 'c1');
  assert.equal(columnByName(cols, 'Nope'), null);
});

test('derivedDeps is the union of prompt refs and attachments, in that order', () => {
  const cols = [col('c1', 'A'), agent('c2', 'B', 'x'), agent('c3', 'C', 'use {{A}} and {{B}}', ['c2'])];
  assert.deepEqual(derivedDeps(cols[2], cols), ['c1', 'c2']);
  assert.deepEqual(derivedDeps(cols[0], cols), [], 'a plain column reads nothing');
});

test('a forward reference is an error, and it names both columns', () => {
  const s = sheet([agent('c1', 'Fit', 'score {{Brief}}'), agent('c2', 'Brief', 'write about it')]);
  const e = validate(s).errors.find((x) => x.what.includes('not to its left'));
  assert.ok(e, 'a forward reference must be refused');
  assert.match(e.fix, /Move "Brief" before "Fit"/);
});

test('a reference to a column at the same index is a forward reference too', () => {
  const s = sheet([agent('c1', 'Self', 'loop {{Self}}')]);
  assert.ok(validate(s).errors.some((x) => x.what.includes('not to its left')));
});

test('duplicate column names are refused — {{Name}} would be ambiguous', () => {
  const s = sheet([col('c1', 'Brief'), col('c2', 'brief')]);
  const e = validate(s).errors.find((x) => x.what.includes('repeats the name'));
  assert.ok(e);
  assert.match(e.fix, /agent prompts address columns as/);
});

test('an unknown column type is refused and the message lists the real ones', () => {
  const e = validate(sheet([col('c1', 'A', 'formula')])).errors.find((x) => x.where === 'columns[0]');
  assert.match(e.what, /has type "formula"/);
  assert.match(e.fix, /text number select tags checkbox date url harness/);
});

test('harness config: object present iff the type is harness', () => {
  assert.ok(errorsOf(sheet([col('c1', 'A', 'harness')])).some((m) => m.includes('no "harness" object')));
  assert.ok(errorsOf(sheet([col('c1', 'A', 'text', { harness: { prompt: 'x' } })]))
    .some((m) => m.includes('not an agent column')));
});

test('an invented agent id is refused; empty is fine', () => {
  const bad = sheet([col('c1', 'A', 'harness', { harness: { harness_id: 'chrn_abc', prompt: 'do {{A}}' } })]);
  assert.ok(validate(bad).errors.some((e) => e.where.endsWith('harness_id')));
  const ok = sheet([col('c1', 'A'), agent('c2', 'B', 'do {{A}}')]);
  assert.deepEqual(validate(ok).errors, []);
});

test('attach must name an EARLIER AGENT column', () => {
  const notAgent = sheet([col('c1', 'A'), agent('c2', 'B', 'do {{A}}', ['c1'])]);
  assert.ok(validate(notAgent).errors.some((e) => e.what.includes('not an agent column')));

  const later = sheet([agent('c1', 'A', 'x {{B}}', ['c2']), col('c2', 'B')]);
  assert.ok(validate(later).errors.some((e) => e.where.endsWith('attach')));

  const good = sheet([col('c1', 'A'), agent('c2', 'B', 'do {{A}}'), agent('c3', 'C', 'judge {{B}}', ['c2'])]);
  assert.deepEqual(validate(good).errors, []);
});

test('a cells key must be <rowId>:<colId> with both resolving', () => {
  const cols = [col('c1', 'Company')];
  // The classic: the key uses the column NAME. It renders nothing, silently.
  const byName = sheet(cols, [{ id: 'row_1' }], { 'row_1:Company': { value: 'x' } });
  assert.ok(validate(byName).errors.some((e) => e.what.includes('does not exist')));

  const noRow = sheet(cols, [{ id: 'row_1' }], { 'row_9:c1': { value: 'x' } });
  assert.ok(validate(noRow).errors.some((e) => e.what.includes('row "row_9"')));

  const malformed = sheet(cols, [{ id: 'row_1' }], { row_1c1: { value: 'x' } });
  assert.ok(validate(malformed).errors.some((e) => e.what.includes('not a "<rowId>:<colId>" key')));
});

test('a bare value at a cell key is refused', () => {
  const s = sheet([col('c1', 'A')], [{ id: 'row_1' }], { 'row_1:c1': 'plain' });
  assert.ok(validate(s).errors.some((e) => e.what === 'is not an object'));
});

test('run state in a plain cell is refused — it claims a run that never happened', () => {
  const s = sheet([col('c1', 'A')], [{ id: 'row_1' }],
                  { 'row_1:c1': { value: 'x', status: 'done', session_id: 'hsess1' } });
  const e = validate(s).errors.find((x) => x.what.includes('in a plain column'));
  assert.ok(e);
  assert.match(e.what, /status/);
  assert.match(e.what, /session_id/);
});

test('an agent cell that RAN needs both run_id and session_id; a skipped one does not', () => {
  const cols = [col('c1', 'A'), agent('c2', 'B', 'do {{A}}')];
  const half = sheet(cols, [{ id: 'row_1' }], { 'row_1:c2': { run_id: 'run_1', status: 'done' } });
  assert.ok(validate(half).errors.some((e) => e.what.includes('only one of run_id')));

  // The app writes exactly this for a cell it never dispatched. Flagging it made the sheet page
  // show the person an error about its own correct output.
  const skipped = sheet(cols, [{ id: 'row_1' }],
                        { 'row_1:c2': { run_id: 'run_1', status: 'skipped', error: 'A is empty in this row.' } });
  assert.deepEqual(validate(skipped).errors, []);

  const both = sheet(cols, [{ id: 'row_1' }],
                     { 'row_1:c2': { run_id: 'run_1', session_id: 'hsess1', status: 'done', value: 'v' } });
  assert.deepEqual(validate(both).errors, []);
});

test('duplicate ids are refused for both columns and rows', () => {
  assert.ok(errorsOf(sheet([col('c1', 'A'), col('c1', 'B')])).some((m) => m.includes('repeats the id')));
  assert.ok(errorsOf(sheet([col('c1', 'A')], [{ id: 'r' }, { id: 'r' }])).some((m) => m.includes('repeats the id')));
});

test('the wrong schema is refused rather than guessed at', () => {
  const s = { ...sheet([col('c1', 'A')]), meta: { schema: 2, title: 'T' } };
  assert.ok(validate(s).errors.some((e) => e.where === 'meta.schema'));
});

test('warnings do not block: a prompt with no reference, an off-list option, a loose number', () => {
  const s = sheet(
    [col('c1', 'Stage', 'select', { options: ['Todo', 'Done'] }),
     col('c2', 'Count', 'number'),
     agent('c3', 'Same', 'summarise the market')],
    [{ id: 'row_1' }],
    { 'row_1:c1': { value: 'Blocked' }, 'row_1:c2': { value: '7' } },
  );
  const { errors, warnings } = validate(s);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((w) => w.what.includes('references no columns')));
  assert.ok(warnings.some((w) => w.what.includes('not one of the column')));
  assert.ok(warnings.some((w) => w.what.includes('non-number')));
});

test('interpolate substitutes by name and reports empties instead of blanking them', () => {
  const cols = [col('c1', 'Company'), col('c2', 'Site')];
  const both = interpolate('Read {{Site}} on {{Company}}', cols, { c1: 'Northwind', c2: 'https://x' });
  assert.equal(both.text, 'Read https://x on Northwind');
  assert.deepEqual(both.missing, []);

  const half = interpolate('Read {{Site}} on {{Company}}', cols, { c1: 'Northwind', c2: '' });
  assert.deepEqual(half.missing, ['Site'], 'an empty upstream cell is named, not silently blanked');
});

test('interpolate survives quotes, newlines and braces in the substituted value', () => {
  const cols = [col('c1', 'Brief')];
  const v = 'He said "no".\nThen {{not a ref}} — 100%';
  const out = interpolate('Judge this:\n\n{{Brief}}', cols, { c1: v });
  assert.equal(out.text, `Judge this:\n\n${v}`);
  assert.deepEqual(out.missing, []);
});

test('an unknown reference is left alone — the planner refuses the run and says which', () => {
  const out = interpolate('hi {{Ghost}}', [col('c1', 'A')], { c1: 'x' });
  assert.equal(out.text, 'hi {{Ghost}}');
});

test('cellText covers every column type', () => {
  assert.equal(cellText({ value: 'x' }, col('c', 'A', 'text')), 'x');
  assert.equal(cellText({ value: 42 }, col('c', 'A', 'number')), '42');
  assert.equal(cellText({ value: 0 }, col('c', 'A', 'number')), '0', 'zero is a value, not an absence');
  assert.equal(cellText({ value: '2026-01-01' }, col('c', 'A', 'date')), '2026-01-01');
  assert.equal(cellText({ value: 'https://x' }, col('c', 'A', 'url')), 'https://x');
  assert.equal(cellText({ value: 'Done' }, col('c', 'A', 'select')), 'Done');
  assert.equal(cellText({ value: ['a', 'b'] }, col('c', 'A', 'tags')), 'a, b');
  assert.equal(cellText({ value: true }, col('c', 'A', 'checkbox')), 'yes');
  assert.equal(cellText({ value: false }, col('c', 'A', 'checkbox')), 'no');
  assert.equal(cellText({ value: 'summary' }, col('c', 'A', 'harness')), 'summary');
  assert.equal(cellText(undefined, col('c', 'A', 'text')), '');
  assert.equal(cellText({ value: null }, col('c', 'A', 'text')), '');
});

test('materialize gives a template fresh ids and remaps attach and cells with them', () => {
  const tpl = {
    meta: { title: 'Scan' },
    columns: [col('c1', 'A'), agent('c2', 'B', 'do {{A}}'), agent('c3', 'C', 'judge {{B}}', ['c2'])],
    rows: [{ id: 'r1' }],
    cells: { 'r1:c1': { value: 'seed' }, 'r9:c1': { value: 'orphan' } },
  };
  const s = materialize(tpl, 'My scan');
  assert.equal(s.meta.title, 'My scan');
  assert.equal(s.meta.schema, 1);
  assert.notEqual(s.columns[0].id, 'c1');
  assert.deepEqual(s.columns[2].harness.attach, [s.columns[1].id], 'attach follows the new ids');
  assert.deepEqual(Object.keys(s.cells), [cellKey(s.rows[0].id, s.columns[0].id)],
                   'a cell naming a row the template does not have is dropped, not carried');
  assert.deepEqual(validate(s).errors, []);
});

test('a column referenced twice is named once when it is empty', () => {
  const cols = [col('c1', 'Company')];
  const out = interpolate('About {{Company}}. Save notes for {{Company}}.', cols, { c1: '' });
  assert.deepEqual(out.missing, ['Company'], '"Company and Company are empty" is not a sentence');
});
