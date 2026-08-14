// Voice input, using the recogniser the browser already has.
//
// There is no speech service in this deployment and no reason to add one: Chrome, Edge and Safari
// ship SpeechRecognition, and it is exactly the feature — speak, get text in the box. Where the
// API is absent, createDictation() returns null and the caller renders no button at all. A
// disabled microphone labelled "coming soon" is a control that does nothing, which is worse than
// its absence: it says the product has a capability it does not have.

const Impl = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function createDictation({ lang } = {}) {
  if (!Impl) return null;
  let rec = null;

  return {
    /** onText fires once per finished phrase, so the draft grows as you speak rather than being
     *  rewritten from scratch on every interim guess. */
    start({ onText, onEnd, onError }) {
      this.stop();
      rec = new Impl();
      rec.lang = lang || navigator.language || 'en-US';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          if (!e.results[i].isFinal) continue;
          const text = String(e.results[i][0]?.transcript || '').trim();
          if (text) onText?.(text);
        }
      };
      // 'no-speech' and 'aborted' are the two ways a quiet or cancelled session ends. Neither is
      // a failure worth telling anyone about; both just stop.
      rec.onerror = (e) => {
        rec = null;
        if (e.error === 'no-speech' || e.error === 'aborted') onEnd?.();
        else onError?.(e.error || 'Dictation stopped.');
      };
      rec.onend = () => { rec = null; onEnd?.(); };
      try {
        rec.start();
      } catch (e) {
        rec = null;
        onError?.(e?.message || 'Dictation could not start.');
      }
    },

    stop() {
      if (!rec) return;
      const r = rec;
      rec = null;
      try { r.stop(); } catch { /* already stopped */ }
    },
  };
}
