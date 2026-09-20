// The stage: the frame of the browser the model is playing in, with the run's figures over it.
//
// Every number here is counted from the run's own stream: actions from the tool calls, deaths
// from the lives the environment states, the frame rate from frames this page actually showed.
// Nothing is estimated.
import { Eye, Keyboard, Play, Square, Zap } from 'lucide-react';
import { CONSOLE_KITS } from '../lib/kit';
import { statusLabel } from '../lib/game';

function Empty({ harness, status, running, onPlay }) {
  if (harness === null) {
    return (
      <div className="mk-empty">
        <div className="mk-empty-t">Super Mario has not been launched yet</div>
        <div>Launch it from Starter Kits and come back here.</div>
        <a className="btn mk-play" href={CONSOLE_KITS}>Open Starter Kits</a>
      </div>
    );
  }
  if (running) {
    return (
      <div className="mk-empty">
        <span className="mk-pulse" aria-hidden="true" />
        <div className="mk-empty-t">Starting the browser</div>
        <div>The game is loading in a browser inside this deployment. Its frame appears here as soon as it draws.</div>
      </div>
    );
  }
  if (status) {
    return (
      <div className="mk-empty">
        <div className="mk-empty-t">{statusLabel(status)}</div>
        <div>The frame of this run is no longer available. Start a new run to play again.</div>
      </div>
    );
  }
  return (
    <div className="mk-empty">
      <div className="mk-empty-t">Watch a System One model play</div>
      <div>It reads the game's state a few times a second and holds one key at a time. The browser it plays in appears here.</div>
      <button type="button" className="btn primary mk-play" onClick={onPlay} disabled={harness === undefined}>
        <Play size={16} aria-hidden="true" />Play
      </button>
    </div>
  );
}

function Stat({ label, value }) {
  return <span className="mk-stat"><b>{value}</b><span>{label}</span></span>;
}

export function Stage({ frame, fps, harness, status, running, stats, onPlay, onStop }) {
  const elapsed = stats.startedAt ? Math.round(((stats.endedAt || Date.now()) - stats.startedAt) / 1000) : 0;
  const rate = stats.actions > 1 && stats.firstAt && stats.lastAt > stats.firstAt
    ? ((stats.actions - 1) / ((stats.lastAt - stats.firstAt) / 1000)).toFixed(1) : null;
  return (
    <section className="mk-stage-wrap" aria-label="The game">
      <div className={'mk-stage' + (frame ? ' has-frame' : '')}>
        {frame
          ? <img className="mk-frame" src={frame} alt="The frame of the browser the model is playing in" />
          : <Empty harness={harness} status={status} running={running} onPlay={onPlay} />}
        {frame && (
          <div className="mk-hud">
            {running
              ? <span className="mk-live"><span className="mk-live-dot" aria-hidden="true" />Live{fps > 0 ? ` · ${fps} fps` : ''}</span>
              : <span className="mk-live">{statusLabel(status)}</span>}
            <span className="mk-hud-spacer" />
            {stats.actions > 0 && <Stat label="actions" value={stats.actions} />}
            {rate && <Stat label="a second" value={rate} />}
            {stats.lives != null && <Stat label="deaths" value={stats.deaths} />}
            {elapsed > 0 && <Stat label="s" value={elapsed} />}
            {running && (
              <button type="button" className="btn mk-stop" onClick={onStop}>
                <Square size={12} aria-hidden="true" />Stop
              </button>
            )}
          </div>
        )}
      </div>
      <p className="mk-credits">
        The game is <a href="https://supermarioplay.com/game/mario.html?v=1.0.1" target="_blank" rel="noopener noreferrer">Full Screen Mario at supermarioplay.com</a>;
        Mario belongs to Nintendo and none of the game's files ship here. The browser is driven with <a href="https://github.com/browser-use/browser-use" target="_blank" rel="noopener noreferrer">Browser Use</a> (MIT).
        The model is <a href="https://typesafe.ai" target="_blank" rel="noopener noreferrer">Jev</a> by TypeSafe, a System One model, through OpenRouter.
        The harness is the open-source <a href="https://github.com/HarnessRouter/SystemOneHarness" target="_blank" rel="noopener noreferrer">System One Harness</a>.
      </p>
      <div className="mk-facts" aria-label="How it works">
        <div className="mk-fact">
          <div className="mk-fact-k"><Eye size={14} aria-hidden="true" />Reads the game, not the screen</div>
          <div className="mk-fact-v">Each step the environment states where Mario is and what is ahead, in tiles, as a few plain sentences, and which hold clears the wall.</div>
        </div>
        <div className="mk-fact">
          <div className="mk-fact-k"><Zap size={14} aria-hidden="true" />Decides, never writes</div>
          <div className="mk-fact-v">A System One model picks one control from that state, a few hundred milliseconds a decision, with no screenshot and no text generation.</div>
        </div>
        <div className="mk-fact">
          <div className="mk-fact-k"><Keyboard size={14} aria-hidden="true" />Plays a real browser</div>
          <div className="mk-fact-v">The keys are held in a browser inside this deployment, driven with Browser Use. What you watch is that browser's own frame.</div>
        </div>
      </div>
    </section>
  );
}
