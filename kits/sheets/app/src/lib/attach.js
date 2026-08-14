// Files, on their way into a turn.
//
// One mechanism for both places a file gets attached — the person's own attachment in the
// copilot, and an upstream agent column's artifact handed to the next column. Both become an
// `input_file` block on the turn, which the gateway writes into the working directory before the
// agent starts.
//
// Deliberately NOT a workspace PUT: that needs a session which a brand-new sheet does not have
// yet, it is refused 409 while a turn is running, and it cannot carry bytes that are not text.

/** Per-file cap the API enforces. Refuse a bigger file by name rather than truncating it. */
export const FILE_MAX = 25 * 1024 * 1024;

const MIME = {
  md: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv',
  tsv: 'text/tab-separated-values', html: 'text/html', py: 'text/x-python', js: 'text/javascript',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const mimeOf = (name, fallback = 'application/octet-stream') =>
  MIME[String(name).split('.').pop().toLowerCase()] || fallback;

/** ArrayBuffer -> data: URL, chunked because a single fromCharCode over a large file overflows
 *  the argument stack. */
export function bufferToDataUrl(buf, filename, type) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${type || mimeOf(filename)};base64,${btoa(bin)}`;
}

/** A picked File -> the block a turn takes. Throws with the file's own name if it is too large. */
export async function fileToInput(file) {
  if (file.size > FILE_MAX) {
    throw new Error(`${file.name} is ${Math.round(file.size / 1048576)} MB — the limit is 25 MB.`);
  }
  const buf = await file.arrayBuffer();
  return {
    name: file.name,
    size: file.size,
    block: {
      type: 'input_file',
      filename: file.name,
      file_data: bufferToDataUrl(buf, file.name, file.type),
    },
  };
}

export function bytesLabel(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
