// Getting a sheet out of the app.
//
// Everything here happens in the browser: there is no export service in this deployment, and the
// grid already holds the whole document. CSV and TSV are pure; XLSX lazy-loads its writer so a
// person who never exports one never downloads it.
import { sheetToAoA, sheetToDelimited } from 'reifyui';
import { cellText } from './model';

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (title) => (String(title || 'sheet').replace(/[^\w\- ]+/g, '').trim() || 'sheet');

export async function exportSheet(kind, sheet) {
  const title = sheet?.meta?.title;
  if (kind === 'csv' || kind === 'tsv') {
    // cellText is passed so an agent cell exports as its answer rather than as the run record
    // that surrounds it — a spreadsheet export must never be raw JSON.
    const text = sheetToDelimited(sheet, kind === 'csv' ? ',' : '\t', { cellText });
    download(`${safeName(title)}.${kind}`, new Blob([text], { type: 'text/plain;charset=utf-8' }));
    return;
  }
  if (kind === 'json') {
    // The run result, as asked for: rows, columns, every cell's configuration and the session
    // reference of every agent cell that ran. It is the document itself rather than a second
    // artifact assembled beside it — a second copy is what goes stale.
    download(`${safeName(title)}.json`,
             new Blob([JSON.stringify(sheet, null, 2)], { type: 'application/json' }));
    return;
  }
  if (kind === 'xlsx') {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetToAoA(sheet, { cellText: xlsxCell }));
    ws['!cols'] = (sheet.columns || []).map((c) => ({ wpx: Math.min(400, c.width || 160) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(`${safeName(title)}.xlsx`,
             new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    return;
  }
  throw new Error(`Unknown export format: ${kind}`);
}

/** Numbers and booleans stay themselves so the person can sum the column they exported. */
function xlsxCell(cell, col) {
  const v = cell?.value;
  if (col?.type === 'number' && typeof v === 'number') return v;
  if (col?.type === 'checkbox') return Boolean(v);
  return cellText(cell, col);
}
