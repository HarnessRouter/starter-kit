// Media addresses, pinned.
//
// One function builds every URL in this app, and the test that matters is what it does with a
// missing part. A page asks for a poster before the session id has arrived, or for a clip whose
// media id is still null because the render has not landed — and a URL with an empty segment in it
// is a 404 that looks like a server fault, on a page that simply asked too early.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadName, mediaUrl, mediaUrlFor, posterUrl } from './media.js';

const ADDR = { harnessId: 'hn_1', entryId: 'mcp.media', sessionId: 'sess_1' };

test('a complete address is a same-origin URL under the console proxy', () => {
  // Same-origin is the whole authentication story: the console session the browser already
  // carries authenticates it, so this works directly in <video src> with no token to smuggle
  // into a query string and nothing for a copied link to leak.
  assert.equal(
    mediaUrl({ ...ADDR, mediaId: 'med_9' }),
    '/api/harness/v1/harnesses/hn_1/servers/mcp.media/sessions/sess_1/media/med_9',
  );
});

test('any missing part yields no URL at all', () => {
  assert.equal(mediaUrl({ ...ADDR, mediaId: '' }), '');
  assert.equal(mediaUrl({ ...ADDR, mediaId: null }), '');
  assert.equal(mediaUrl({ ...ADDR, sessionId: '', mediaId: 'med_9' }), '');
  assert.equal(mediaUrl({ ...ADDR, harnessId: undefined, mediaId: 'med_9' }), '');
});

test('every part is escaped, so an id can never open a path of its own', () => {
  const url = mediaUrl({ ...ADDR, sessionId: 'a/b', mediaId: '../secret' });
  assert.equal(url.includes('a/b'), false);
  assert.equal(url.includes('../'), false);
});

test('a bound urlFor asks about one session and nothing else', () => {
  const urlFor = mediaUrlFor(ADDR);
  assert.match(urlFor('med_1'), /sessions\/sess_1\/media\/med_1$/);
  assert.equal(urlFor(''), '');
});

test('a clip with no poster gets none, rather than the clip as its own poster', () => {
  // Pointing `poster` at the video downloads the whole file to show one frame of it, and a
  // <video preload="metadata"> already paints its first frame.
  assert.equal(posterUrl(ADDR, { posterMediaId: '' }), '');
  assert.equal(posterUrl(ADDR, null), '');
  assert.match(posterUrl(ADDR, { posterMediaId: 'med_p' }), /media\/med_p$/);
});

test('a download is named after the video, safely', () => {
  assert.equal(downloadName('Rain on the window'), 'Rain-on-the-window.mp4');
  assert.equal(downloadName('a/b:c*d'), 'abcd.mp4');
  assert.equal(downloadName(''), 'video.mp4');
  assert.equal(downloadName(null), 'video.mp4');
});

test('an embeddable is given an absolute same-origin link, which is what the canvas validates', async () => {
  const { embedLink } = await import('./media.js');
  const link = embedLink(ADDR, { mediaId: 'med_9' }, 'https://console.example');
  assert.equal(link, 'https://console.example/api/harness/v1/harnesses/hn_1/servers/mcp.media/sessions/sess_1/media/med_9');
});

test('a clip with nothing rendered yet still gets a link, pointing at this video’s own page', async () => {
  // Excalidraw caches "is this embeddable valid" per element and skips the ones that are not, so a
  // placeholder with no link is a permanently empty box — even after its render lands.
  const { embedLink } = await import('./media.js');
  assert.equal(
    embedLink(ADDR, { mediaId: '' }, 'https://console.example'),
    'https://console.example/kits/video/#/v/sess_1',
  );
});
