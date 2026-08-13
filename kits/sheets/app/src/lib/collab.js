// Presence, honestly absent.
//
// The hosted product holds a websocket to a collaboration service: other people's cursors and
// live drags stream in as `peers`, and remote deck revisions arrive as `onRemoteDeck`. This build
// has no such service — a kit is one Harness on one instance, and a deck is one session's file.
//
// So this is a real single-player implementation rather than a stub that pretends: `peers` is
// empty, `live` is false, and broadcasting a selection or a drag goes nowhere because there is
// nobody to tell. EditorCanvas takes `peers=[]` and simply draws no peer decorations, which is
// exactly right. Point this at a presence service and the pages need no changes.
//
// The one collaborator this app DOES have is the agent, and that is not handled here: it is the
// turn lock in DeckPage (the canvas goes read-only while a turn runs, and the server refuses
// writes with 409), which is a stronger guarantee than presence could give.
import { useMemo } from 'react';

const NO_PEERS = [];

export function colorFor(key) {
  // Stable per-identity hue, so if a presence backend is added later the colors do not churn.
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 52%)`;
}

export function useDeckCollab() {
  return useMemo(() => ({
    peers: NO_PEERS,
    live: false,
    setSelection: () => {},
    setDrag: () => {},
  }), []);
}
