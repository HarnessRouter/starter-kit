// The harness's own mark for the chat's live line: the base this kit launched on, its logo as the
// console serves it, and the motion reifyui/agent-chat gives that harness. No base, or a logo that
// does not load (a local dev server has no /logos), and the line shows its three dots instead.
import { useEffect, useState } from 'react';
import { kitHarness } from 'reifyui/harness';
import { motionFor } from 'reifyui/agent-chat';

const FILE = { 'claude-code': 'claude.png', dsh: 'deepseek.png', nanobot: 'nanobot.svg' };

export function useHarnessMark() {
  const [base, setBase] = useState('');
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let on = true;
    kitHarness().then((h) => { if (on) setBase(String(h?.base || '')); }).catch(() => {});
    return () => { on = false; };
  }, []);
  if (!base) return { mark: undefined, motion: undefined };
  return {
    mark: broken ? undefined : <img src={`/logos/${FILE[base] || `${base}.png`}`} alt="" onError={() => setBroken(true)} />,
    motion: motionFor(base),
  };
}
