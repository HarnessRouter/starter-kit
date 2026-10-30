// The Content-Disposition for a file the agent made. A header value is bytes, not text: Node's
// setHeader throws ERR_INVALID_CHAR on a raw 报告.md or an emoji in `filename="..."`, so the preview
// and the download answered 500 for exactly the files a non-English agent writes. RFC 6266 is the
// way out, the same shape the HarnessRouter gateway sends: an ASCII stand-in every client can read,
// plus `filename*` with the real name percent-encoded, which every current browser prefers.
// encodeURIComponent leaves ! ' ( ) * ~ alone and RFC 5987 does not allow them unescaped, so those
// are escaped here too.
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  let name = (filename || '').split(/[\\/]/).pop()?.trim() || '';
  if (name === '' || name === '.' || name === '..') name = 'download';
  // One `_` per character, not per UTF-16 unit, so an emoji leaves one placeholder. Control
  // characters are outside the range too, so a line break can never start a header of its own.
  let ascii = name.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/g, '').slice(0, 120);
  if (ascii.replace(/[\s.]/g, '') === '') ascii = 'download';
  const star = encodeURIComponent(name).replace(/[!'()*~]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${star}`;
}
