"""The game as an environment for a System One harness: an MCP server over a headless Chrome.

This is the page-specific half of the kit, and the only page-specific code there is. It opens
Full Screen Mario (played at supermarioplay.com) in a browser it controls over the DevTools
Protocol, reads the game's own state each step and says it as short literal sentences (where
Mario is, whether he is on the ground, what is ahead and how far, in tiles), and acts by holding
the keys the game listens to. The System One base compiles these tools into its action space; the
model chooses among them, several times a second, and never sees a pixel.

Every step also writes the browser's current frame to `frame.jpg` at the workspace root, which
the kit's page shows: what the person watches is the browser the model is playing in.

State definition convention (systemone_harness/tools.py): `observe` and `reset` are the protocol,
every other tool an action whose parameters are enumerable. The browser is Browser Use's session
(browser-use, MIT) over a Chromium the image installs for the base.
"""

import asyncio
import base64
import glob
import os
import pathlib
import shutil
import sys
import threading
import time


GAME_URL = os.environ.get("MARIO_URL", "https://supermarioplay.com/game/mario.html?v=1.0.1")
TILE = 8                      # game units per tile; the game draws a tile as 8 * unitsize px
TICK = 0.10                   # an action sets the keys and holds them this long; they stay set until the next
KEY = {"left": 37, "right": 39, "jump": 38, "down": 40, "sprint": 16}
KEY_NAMES = {37: "left", 39: "right", 38: "jump", 40: "down", 16: "run"}
ITEMS = {"Coin", "Mushroom", "FireFlower", "Star", "Vine", "Text", "Shell", "Fireball"}
INSTRUCTIONS = ("You play a side-scrolling platform game as Mario, deciding several times a second. Each action sets "
                "the keys for the next moment and they stay set until you change them: run_right holds right and run, "
                "jump_right holds right, run and jump, jump holds jump alone, walk_left holds left, wait lets every "
                "key go. The state says where Mario is, what he is doing, what is ahead and behind with distances in "
                "tiles, and which keys are held. Keep moving right and jump over what is within one step. Finish when "
                "the level is cleared. Escalate when Mario has no lives left.")
TALL = 4                      # a wall this tall is cleared only at a run
# The frame the kit's page shows: Chrome's own screencast, a JPEG for every third frame the game
# draws (about twenty a second), each written whole to frame.jpg. The page reads that file.
SCREENCAST = {"format": "jpeg", "quality": 45, "maxWidth": 960, "maxHeight": 600, "everyNthFrame": 3}

STATE_JS = """(function(){
  if (!window.player || !window.gamescreen) return {ready: false};
  // the world scrolls under a player who stays near the screen middle; counting the scroll gives
  // a position in the level (progress the page can show, and the stuck check a real distance)
  if (!window.__s1wrapped && typeof window.scrollWindow === 'function') {
    var _sw = window.scrollWindow; window.__s1scroll = 0; window.__s1wrapped = true;
    window.scrollWindow = function(x){ window.__s1scroll += (x || 0); return _sw.apply(this, arguments); };
  }
  var u = window.unitsize || 4, T = 8 * u, p = player, sl = gamescreen.left, sr = gamescreen.right;
  function tiles(px){ return Math.round(px / T * 10) / 10; }
  var enemies = [], behind = [], gaps = [], walls = [], blocks = [], overhead = [];
  // heights are measured from where Mario stands: his feet on the ground, and in the air the
  // level he last stood on, so a jump does not shrink the wall ahead and a stair step is one
  // tile tall from the step below it, not four from the floor
  if (p.resting) window.__s1ground = p.bottom;
  var ground = p.resting ? p.bottom : (window.__s1ground || ((window.map && map.floor) ? map.floor * u : p.bottom));
  (window.characters || []).forEach(function(c){
    if (!c.alive || c === player || c.title === undefined) return;
    if (['Coin','Mushroom','FireFlower','Star','Vine','Text','Shell','Fireball'].indexOf(c.title) >= 0) return;
    var dx = (c.left - p.right) / T, dy = (p.bottom - c.bottom) / T, back = (p.left - c.right) / T;
    if (dx >= 0 && dx <= 12) enemies.push({kind: c.title, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10, dir: (c.xvel || 0) < 0 ? 'toward' : 'away'});
    else if (back >= 0 && back <= 8) behind.push({kind: c.title, dx: Math.round(back * 10) / 10, dy: Math.round(dy * 10) / 10, dir: (c.xvel || 0) > 0 ? 'toward' : 'away'});
  });
  var floors = (window.solids || []).filter(function(s){ return s.alive && (s.title === 'Floor' || s.title === 'Stone') && s.top >= p.bottom - 4; });
  var x = p.right, gapStart = null;
  for (var i = 0; i <= 12 * T; i += T / 4) {
    var covered = floors.some(function(f){ return f.left <= x + i && x + i <= f.right; });
    if (!covered && gapStart === null) gapStart = i;
    if (covered && gapStart !== null) { if (i - gapStart >= T / 2) gaps.push({dx: tiles(gapStart), width: tiles(i - gapStart)}); gapStart = null; }
  }
  if (gapStart !== null && 12 * T - gapStart >= T / 2) gaps.push({dx: tiles(gapStart), width: tiles(12 * T - gapStart)});
  (window.solids || []).forEach(function(s){
    if (!s.alive || ['Pipe','Block','Brick','Stone'].indexOf(s.title) < 0) return;
    // anything whose far edge is still ahead of Mario counts, including the pipe he is pressed
    // against (he overlaps its edge by a tenth of a tile there, and a dx >= 0 filter lost it:
    // forty steps of "no wall within 8 tiles" against a pipe). A wall stands on the ground: what
    // sits at or below the ground is floor, and what floats a tile or more above it (the block
    // rows) is run under, not jumped
    // behind him with a quarter tile of tolerance: pressed against a pipe's far side he overlaps
    // it by a tenth of a tile, and counted as "0 tiles ahead" it made the run-up jump at once,
    // 4.5 tiles early, into the side of the pipe that was actually ahead (measured)
    if (s.right <= p.left + T / 4 || s.top >= ground - 2 || s.bottom < ground - T) return;
    var dx = Math.max(0, (s.left - p.right) / T);
    if (dx <= 8) walls.push({kind: s.title.toLowerCase(), dx: Math.round(dx * 10) / 10, height: tiles(ground - s.top)});
  });
  enemies.sort(function(a, b){ return a.dx - b.dx; }); behind.sort(function(a, b){ return a.dx - b.dx; });
  (window.solids || []).forEach(function(s){
    // a question block still holding something, at the height a jump reaches (the head gets to
    // about 4.9 tiles); it pays when hit from below
    if (!s.alive || (s.title !== 'Block' && s.title !== 'Brick') || s.hidden) return;
    var up = (ground - s.bottom) / T, dx = (s.left - p.right) / T;
    if (up < 3 || up > 4.5 || s.right <= p.left || dx > 8) return;
    overhead.push({dx: Math.round(Math.max(-1, dx) * 10) / 10});
    if (s.title !== 'Block' || s.used) return;
    if (enemies.length && enemies[0].dx <= 10) return;
    blocks.push({dx: Math.round(Math.max(0, dx) * 10) / 10, up: Math.round(up * 10) / 10});
  });
  enemies.sort(function(a, b){ return a.dx - b.dx; }); walls.sort(function(a, b){ return a.dx - b.dx; }); gaps.sort(function(a, b){ return a.dx - b.dx; }); blocks.sort(function(a, b){ return a.dx - b.dx; });
  walls = walls.filter(function(w, i){ return i === 0 || w.dx !== walls[i - 1].dx || w.height !== walls[i - 1].height; });
  var d = window.data || {};
  function amt(k){ return d[k] && d[k].amount !== undefined ? d[k].amount : null; }
  return {ready: true, x: tiles(p.left), y: tiles(ground - p.bottom), level_x: tiles(p.left + (window.__s1scroll || 0)),
          dying: !!p.dying,
          screen_tiles: tiles(sr - sl), xvel: Math.round((p.xvel || 0) * 10) / 10, yvel: Math.round((p.yvel || 0) * 10) / 10, on_ground: !!p.resting, dead: !!p.dead,
          power: p.power || 1, enemies: enemies.slice(0, 3), behind: behind.slice(0, 2), gaps: gaps.slice(0, 2), walls: walls.slice(0, 2), blocks: blocks.slice(0, 2), overhead: overhead.slice(0, 4),
          lives: amt('lives'), time: amt('time'), score: amt('score'), coins: amt('coins'), world: amt('world'), paused: !!window.paused,
          ending: !!(window.map && map.ending)};
})()"""


def find_chrome() -> str | None:
    """A Chromium to launch: the one named, the base's Playwright install, or a system Chrome."""
    for env in ("MARIO_CHROME", "S1_CHROME"):
        if os.environ.get(env) and os.path.exists(os.environ[env]):
            return os.environ[env]
    roots = [os.environ.get("PLAYWRIGHT_BROWSERS_PATH"), "/data/agent-tools/ms-playwright",
             os.path.expanduser("~/.cache/ms-playwright")]
    for root in roots:
        if not root:
            continue
        for pat in ("chromium-*/chrome-linux*/chrome", "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
                    "chromium_headless_shell-*/chrome-linux*/headless_shell"):
            hits = sorted(glob.glob(os.path.join(root, pat)))
            if hits:
                return hits[-1]
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
              "/usr/bin/chromium", "/usr/bin/chromium-browser"):
        if os.path.exists(p):
            return p
    return shutil.which("google-chrome") or shutil.which("chromium") or None


def workspace_root() -> pathlib.Path:
    """Where the kit's page reads the frame from: the session workspace, three levels above the
    plugin root the runner materialised (.harness/plugins/<name>)."""
    root = os.environ.get("PLUGIN_ROOT")
    if root:
        return pathlib.Path(root).resolve().parents[2]
    return pathlib.Path.cwd()


class Game:
    def __init__(self):
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, daemon=True, name="mario-loop").start()
        self._session = None
        self._cdp = None
        self.frame_path = workspace_root() / "frame.jpg"
        self.started_at = time.time()
        self.steps = 0
        self.frames = 0
        self._stopped = 0          # consecutive runs that moved nothing
        self._acted_at: list[float] = []   # when each action landed: the loop's own pace, measured

        self._lives = None
        self._restarting_until = 0.0
        self._held: set[int] = set()

    def _run(self, coro, timeout: float = 120.0):
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(timeout)

    async def _start(self):
        if self._session is not None:
            return
        from browser_use.browser import BrowserProfile, BrowserSession
        chrome = find_chrome()
        if not chrome:
            raise RuntimeError("no Chromium to launch: set PLAYWRIGHT_BROWSERS_PATH or MARIO_CHROME")
        profile = BrowserProfile(headless=True, executable_path=chrome, user_data_dir=None,
                                 viewport={"width": 960, "height": 600}, window_size={"width": 960, "height": 600})
        self._session = BrowserSession(browser_profile=profile)
        await self._session.start()
        await self._session.navigate_to(GAME_URL)
        self._cdp = await self._session.get_or_create_cdp_session()
        self._cdp.cdp_client.register.Page.screencastFrame(self._on_frame)
        await self._screencast()
        for _ in range(80):
            st = await self._eval(STATE_JS)
            if isinstance(st, dict) and st.get("ready"):
                break
            await asyncio.sleep(0.25)
        await self._eval("window.unpause && unpause(); 'ok'")

    async def _screencast(self) -> None:
        await self._cdp.cdp_client.send.Page.startScreencast(params=SCREENCAST, session_id=self._cdp.session_id)

    def _on_frame(self, ev: dict, session_id=None) -> None:
        """Runs on the browser loop for every screencast frame: the JPEG goes to frame.jpg whole
        (a temp file renamed over it, so a reader never sees half a picture), and the frame is
        acknowledged, without which Chrome stops sending."""
        try:
            tmp = self.frame_path.with_suffix(".jpg.tmp")
            tmp.write_bytes(base64.b64decode(ev["data"]))
            os.replace(tmp, self.frame_path)
            self.frames += 1
        except Exception:  # noqa: BLE001 - a missed frame is a missed frame, never a failed step
            pass
        self._loop.create_task(self._cdp.cdp_client.send.Page.screencastFrameAck(
            params={"sessionId": ev["sessionId"]}, session_id=self._cdp.session_id))

    async def _eval(self, expression: str):
        r = await self._cdp.cdp_client.send.Runtime.evaluate(params={"expression": expression, "returnByValue": True},
                                                             session_id=self._cdp.session_id)
        return (r.get("result") or {}).get("value")

    async def _keys(self, *codes: int) -> None:
        """Set the held keys to exactly these: press what is missing, release the rest. A key
        stays down across decisions until an action leaves it out, the way a thumb does."""
        for c in list(self._held):
            if c not in codes:
                await self._eval(f"keyup({c}); 'ok'")
                self._held.discard(c)
        for c in codes:
            if c not in self._held:
                await self._eval(f"keydown({c}); 'ok'")
                self._held.add(c)

    async def _up(self, *codes: int) -> None:
        for c in codes:
            if c in self._held:
                await self._eval(f"keyup({c}); 'ok'")
                self._held.discard(c)

    async def _tick(self, name: str) -> None:
        """The key state each action means, held for one tick. The environment executes; it
        does not time anything for the model: where to leave the ground is the model's call,
        from the facts the state and its instructions carry."""
        R, S, U, L = KEY["right"], KEY["sprint"], KEY["jump"], KEY["left"]
        keys = {"run_right": (R, S), "jump_right": (R, S, U), "jump": (U,), "walk_left": (L,), "wait": ()}[name]
        if U in keys and U in self._held and await self._eval("!!player.resting"):
            # "jump" means press jump: a key still held from the last jump would do nothing on
            # the ground (the game wants a release first), so it is let go and pressed again,
            # the way a thumb does. Recorded: four lives to a jump that never happened
            await self._eval(f"keyup({U}); 'ok'")
            self._held.discard(U)
            await asyncio.sleep(0.04)
        await self._keys(*keys)
        await asyncio.sleep(TICK)

    async def _unstick(self) -> None:
        """Held into a pipe's side in the air, Mario "falls" in place at terminal speed for as long
        as a key is held (measured: yvel 7, no movement, a whole life against the fourth pipe).
        Letting go of every key drops him to the ground within a second (measured); the run key
        comes back once he is down."""
        if not await self._eval("!player.resting && !player.dead && !player.dying && player.yvel >= 6.9"):
            return
        y0 = await self._eval("player.bottom")
        await asyncio.sleep(0.12)
        if await self._eval("player.bottom") != y0:
            return
        held = set(self._held)
        await self._up(*held)
        for _ in range(40):
            await asyncio.sleep(0.03)
            if await self._eval("!!player.resting || !!player.dead || !!player.dying"):
                break
        if KEY["right"] in held:
            await self._down(KEY["right"], KEY["sprint"])

    # ── the tools ──
    def reset(self, goal: str) -> dict:
        async def go():
            await self._start()
            await self._session.navigate_to(GAME_URL)
            for _ in range(80):
                st = await self._eval(STATE_JS)
                if isinstance(st, dict) and st.get("ready"):
                    break
                await asyncio.sleep(0.25)
            await self._eval("window.unpause && unpause(); 'ok'")
            try:
                await self._screencast()
            except Exception:  # noqa: BLE001 - already running across the navigation
                pass
            return {"ok": True}
        self.steps = 0
        return self._run(go())

    def observe(self) -> dict:
        async def go():
            await self._start()
            st = await self._eval(STATE_JS)
            return st if isinstance(st, dict) else {"ready": False}
        st = self._run(go())
        return self._describe(st)

    async def _settled(self) -> dict:
        """The state once the level is back after a death: while it restarts the clock is frozen and
        the floors are gone (the gap that is not there); an action during that window is spent.
        And never a state held inside a pipe's side: see _unstick."""
        await self._unstick()
        st = await self._eval(STATE_JS)
        if isinstance(st, dict) and self._restarting(st):
            await self._up(*list(self._held))
            for _ in range(20):
                await asyncio.sleep(0.25)
                st = await self._eval(STATE_JS)
                if isinstance(st, dict) and st.get("ready") and st.get("on_ground") and not self._restarting(st):
                    break
        return st if isinstance(st, dict) else {"ready": False}

    def _restarting(self, st: dict) -> bool:
        lives = st.get("lives")
        if self._lives is not None and lives is not None and lives < self._lives:
            self._restarting_until = time.time() + 4.0
            self._loop.call_soon_threadsafe(lambda: self._loop.create_task(self._eval("window.__s1scroll = 0; 'ok'")))
        if lives is not None:
            self._lives = lives
        if st.get("dead") or st.get("dying"):
            self._restarting_until = max(self._restarting_until, time.time() + 3.0)
        return time.time() < self._restarting_until

    def lag(self) -> float:
        """Seconds from the state a decision reads to the moment it lands, measured as the loop
        runs: the median of the last intervals between actions, less the tick itself. The pace
        differs by deployment (3.4 decisions a second here, 2.2 through a relay), so a constant
        would say "now" at the wrong tile."""
        gaps = [b - a for a, b in zip(self._acted_at[-8:], self._acted_at[-7:])]
        if len(gaps) < 3:
            return 0.3
        gaps.sort()
        return min(0.9, max(0.12, gaps[len(gaps) // 2] - TICK))

    def act(self, name: str) -> dict:
        self._acted_at.append(time.time())
        async def go():
            await self._start()
            await self._tick(name)
            return await self._settled()
        st = self._run(go())
        self.steps += 1
        stuck = name in ("run_right", "jump_right") and st.get("on_ground") and abs(st.get("xvel") or 0) < 0.5 and not st.get("dying")
        self._stopped = self._stopped + 1 if stuck else 0
        d = self._describe(st)
        held = "+".join(KEY_NAMES[c] for c in sorted(self._held, key=lambda c: list(KEY_NAMES).index(c))) or "nothing"
        d["text"] = f"{name}: holding {held}. " + d["text"]
        return d

    def _now(self, st: dict, reach: float, en: list, gaps: list, walls: list, blocks: list, overhead: list) -> str:
        """What the measured facts call for, said for the moment the decision will land: a
        decision arrives about a quarter second after this state, and at a run Mario covers
        2.5 tiles in that time, so every distance here is projected by that much. Measured on
        the live game: a running jump started 3 to 4 tiles before the first Goomba survives
        every time (5 to 9 tiles hits the block row and drops onto it); a 4-tile pipe is cleared
        by a long jump taken 2 to 3 tiles before it at speed; a gap by a running jump from its
        edge. The environment executes nothing here; the model reads it and chooses."""
        held = KEY["jump"] in self._held
        on_ground = st.get("on_ground")
        xv = abs(st.get("xvel") or 0)
        fast = xv >= 3
        lag = round(xv * 60 * self.lag() / (8 * 4), 1)    # tiles covered before the decision lands, at the measured pace
        rising = (st.get("yvel") or 0) < 0
        if not on_ground:
            if held and rising:
                return "keep jump_right held: Mario is still rising, and the jump grows as long as it is held."
            # measured: right kept through the descent lands 9.4 tiles on and slides 2 more; left
            # held brakes the flight to 6.8 tiles and lands him stopped. Recorded five times: the
            # jump over the fourth pipe lands a tile before the first gap and the run carries him in
            gap_close = gaps and gaps[0]["dx"] <= 4.5
            foe_close = any(abs(e["dy"]) < 1 and e["dx"] <= 4 for e in en)
            if fast and (gap_close or foe_close):
                what = "the gap" if gap_close else "the enemy"
                return f"walk_left now: in the air it brakes, and Mario lands stopped short of {what}; then jump_right from there at a run."
            return "falling: run_right keeps the run."
        near = next((e for e in en if abs(e["dy"]) < 1), None)
        near_next = (near["dx"] - lag - (0.5 if near.get("dir") == "toward" else 0)) if near else None
        back = next((b for b in st.get("behind") or [] if b.get("dir") == "toward" and abs(b["dy"]) < 1 and b["dx"] <= 2.5), None)
        # an enemy about to touch him outranks everything: it is the lethal thing. Measured: from
        # standing, jump_right as it arrives (1 to 2.5 tiles) survives every time
        above = next((e for e in en if e["dy"] > 1 and e["dx"] <= 5 and e.get("dir") == "toward"), None)
        if near is not None and near["dx"] <= 4 and not fast:
            if near.get("dir") == "toward":
                return "jump_right now: the enemy is about to reach Mario." if near_next <= 2.2 else "wait, standing still; jump_right when it is 2 tiles away."
            return "walk_left one decision to make room, then run_right and jump_right when it is about 6 tiles ahead."
        if back is not None and not fast:
            return "jump, standing (the jump tool, not jump_right): the enemy at Mario's back passes under him."
        if above is not None and (near is None or near["dx"] > 6):
            # recorded five times: the Goomba on the ledge walks off its edge and drops onto a Mario
            # running under it
            return "wait, standing still: the enemy above is about to drop off its ledge; jump_right when it is 2 tiles away at Mario's height."
        if walls and walls[0]["height"] >= TALL and walls[0]["dx"] <= 8:
            # measured: the pipe is cleared at near full speed (4.9 and up) with the jump held
            # long; at a jog the apex is level with its top and the side stops him (recorded)
            w = walls[0]; w_next = w["dx"] - lag
            full = xv >= 4.5
            follower = next((b for b in st.get("behind") or [] if b.get("dir") == "toward" and abs(b["dy"]) < 1 and b["dx"] <= 6), None)
            if not full and w["dx"] <= 4.5:
                if follower is not None:
                    return "jump, standing (the jump tool): the enemy behind passes under; then walk_left two decisions and run at the pipe."
                return "too slow for the pipe from here: walk_left for two decisions, then run_right to full speed and jump_right at 2 to 3 tiles."
            if not full:
                return "run_right to full speed; jump_right when the pipe is about 5 tiles ahead and Mario is running flat out."
            if 1.8 <= w_next <= 3.4:
                return "jump_right now, and keep it held for three decisions: the pipe's take-off point is here."
            if w_next < 1.8:
                return "jump_right now and hold it three decisions."
            return "run_right toward the pipe; jump_right when it is about 5 tiles ahead at this speed."
        if near is not None and near["dx"] <= 9:
            if fast:
                # measured: under the block row the take-off must be 3 to 4 tiles before it; in the
                # open a running jump from farther lands past it just the same
                if near_next <= (3.8 if overhead else 5.5):
                    return "jump_right now over the enemy: at this speed the take-off comes a few tiles before it."
                return "run_right; jump_right when the enemy is about 7 tiles ahead at this speed."
            if near.get("dir") == "toward":
                return "jump now, standing: it is about to reach Mario." if near_next <= 1.5 else "wait, standing still; jump when it is 2 tiles away."
            return "run_right after it; jump_right when it is about 7 tiles ahead at a run."
        if gaps and gaps[0]["dx"] <= 8:
            g_next = gaps[0]["dx"] - lag
            # recorded six times: the jump across lands nine tiles on, among the enemies waiting
            # there (a pair beyond the gap, a Goomba dropping off its ledge). Ones walking toward
            # the gap come to it and fall in; the jump waits for a clear landing
            # an enemy above the landing (on the ledge past the first gap) drops off its edge
            # whichever way it walks now, so it counts whatever its direction (recorded five times)
            zone = [e for e in en if gaps[0]["dx"] + 1 <= e["dx"] <= gaps[0]["dx"] + 11 and (e["dy"] > 1 or e.get("dir") == "toward")]
            if zone:
                if xv < 1 and gaps[0]["dx"] <= 4:
                    return "wait, standing still at the gap: the enemies beyond it are walking to it and will fall in; jump_right when none stands within 10 tiles past the edge, or when one is 2 tiles away."
                if gaps[0]["dx"] <= 4:
                    return "wait (let every key go) before the gap: enemies wait where the jump would land."
            if xv >= 4:
                return "jump_right now, from the gap's edge, at a run." if g_next <= 2.0 else "run_right to the gap; jump_right when its edge is about 4 tiles ahead at this speed."
            if gaps[0]["dx"] >= 3.5:
                return "run_right to gain speed for the gap; jump_right when its edge is about 4 tiles ahead at a run."
            return "too slow for the gap: walk_left two decisions, then run_right and jump_right when its edge is 4 tiles ahead."
        if walls and walls[0]["dx"] - lag <= 1.5:
            return "jump_right now over the wall ahead."
        if blocks and blocks[0]["dx"] - lag <= 1.8:
            return "jump_right now, under the question block, for the coin."
        return "nothing within reach: run_right."

    def _describe(self, st: dict) -> dict:
        if not st.get("ready"):
            return {"ok": True, "text": "The game is loading.", "fields": {"ready": False}, "candidates": {}, "terminal": False, "realtime": True}
        restarting = self._restarting(st)
        if restarting:
            lives = st.get("lives")
            return {"ok": True, "text": f"Mario has just died. Lives left: {lives}. The level restarts from the beginning in a moment; wait.",
                    "fields": {"dead": True, "lives": lives, "restarting": True}, "candidates": {},
                    "terminal": bool(lives is not None and lives <= 0), "realtime": True}
        parts = []
        if st.get("dead"):
            parts.append("Mario has just died; the level restarts in a moment.")
        else:
            motion = ("moving right" if st["xvel"] > 0.3 else "moving left" if st["xvel"] < -0.3 else "standing still")
            parts.append(f"Mario is {'on the ground' if st['on_ground'] else 'in the air'} at x {st['x']} tiles of a "
                         f"{st['screen_tiles']} tile screen, {motion}.")
        en = st.get("enemies") or []
        if en:
            e = en[0]
            where = "at Mario's height" if abs(e["dy"]) < 1 else ("above" if e["dy"] > 0 else "below")
            arrives = f", at Mario in about {max(1, round(e['dx'] / (1.5 * (self.lag() + TICK))))} decisions if he stands still" if e.get("dir") == "toward" and abs(e["dy"]) < 1 else ""
            parts.append(f"Nearest enemy: {e['kind']} {e['dx']} tiles ahead, {where}, walking {'toward Mario' if e.get('dir') == 'toward' else 'away'}{arrives}."
                         + (f" {len(en) - 1} more behind it." if len(en) > 1 else ""))
        else:
            parts.append("No enemy within 12 tiles ahead.")
        back = st.get("behind") or []
        if back:
            b = back[0]
            parts.append(f"Behind Mario: {b['kind']} {b['dx']} tiles back, walking {'toward him' if b.get('dir') == 'toward' else 'away'}.")
        gaps = st.get("gaps") or []
        parts.append(f"Gap in the ground: edge {gaps[0]['dx']} tiles ahead, {gaps[0]['width']} tiles wide; a running jump from the edge crosses it, a standing one falls in." if gaps
                     else "No gap in the ground within 12 tiles.")
        walls = st.get("walls") or []
        if walls:
            w = walls[0]
            need = ("a jump held for three decisions from a run, leaving the ground 2 to 3 tiles before it; from against it or from standing it is never cleared"
                    if w["height"] >= TALL else "a jump held for two decisions" if w["height"] >= 3 else "a jump")
            parts.append(f"Wall ahead: {w['kind']} {w['dx']} tiles ahead, {w['height']} tiles tall; it takes {need}.")
        else:
            parts.append("No pipe or wall within 8 tiles.")
        overhead = [o for o in st.get("overhead") or [] if o["dx"] <= 6]
        if overhead:
            parts.append(f"Blocks overhead {overhead[0]['dx']} tiles ahead: a running jump there hits them and drops Mario straight down.")
        blocks = st.get("blocks") or []
        if blocks:
            b = blocks[0]
            where = "right overhead" if b["dx"] <= 0 else f"{b['dx']} tiles ahead"
            parts.append(f"Question block {where}, {b['up']} tiles up; jump_right under it pays a coin.")
        # what one step reaches, and what is inside it: the fact the rule needs, stated rather
        # than left for the model to work out from a speed and a distance (it jumped one step late)
        # measured on the live game: at a run the distance to a walking enemy closes about 5.5
        # to 7.8 tiles a step (11.5 -> 6 -> 1.3; 9.8 -> 2), a standing wall about 4; the hold, the
        # model's answer and the enemy's own walk all fit in one step, and an enemy 2 tiles away
        # at a run is already too close to jump, so it is named a step earlier than it arrives
        # at the loop's measured pace: at a full run (9 tiles a second) a third of a second is
        # 3 tiles, and a walking enemy adds about half a tile of its own
        reach = round(max(0.5, abs(st.get("xvel") or 0) * 60 * (self.lag() + TICK) / (8 * 4)), 1)
        closing = round(reach + 0.6, 1)
        within = [f"the {en[0]['kind']} {en[0]['dx']} tiles ahead"] if en and en[0]["dx"] <= closing + 2.5 else []
        within += [f"the gap {gaps[0]['dx']} tiles ahead"] if gaps and gaps[0]["dx"] <= reach + 0.5 else []
        within += [f"the {walls[0]['kind']} {walls[0]['dx']} tiles ahead"] if walls and walls[0]["dx"] <= reach + 0.5 else []
        within += [f"the question block {blocks[0]['dx']} tiles ahead"] if blocks and blocks[0]["dx"] <= reach + 0.5 else []
        parts.append(f"Until the next decision Mario covers about {reach} tiles, and a walking enemy closes about {closing}. "
                     + (f"Within one step: {'; '.join(within)}." if within else "Nothing is within one step."))
        parts.append("Now: " + self._now(st, reach, en, gaps, walls, blocks, overhead))
        if self._stopped >= 2:
            parts.append(f"Mario has been stopped in place for {self._stopped} decisions by something he is pressed "
                         "against: walk_left, then run_right, then jump_right at 2 to 3 tiles.")
        held = [KEY_NAMES[c] for c in self._held]
        if KEY["jump"] in self._held and not st.get("on_ground"):
            parts.append("The jump key is held; it keeps the jump growing while Mario rises.")
        parts.append(f"Lives {st.get('lives')}, coins {st.get('coins')}, time {st.get('time')}, score {st.get('score')}.")
        terminal = bool(st.get("ending")) or (bool(st.get("dead")) and (st.get("lives") or 0) <= 0)
        fields = {k: st.get(k) for k in ("x", "y", "level_x", "on_ground", "dead", "xvel", "lives", "coins", "time", "score", "world")}
        fields["enemies"] = en
        fields["behind"] = st.get("behind") or []
        fields["gaps"] = gaps
        fields["walls"] = walls
        fields["blocks"] = blocks
        fields["stopped_steps"] = self._stopped
        fields["step_reach_tiles"] = reach
        fields["within_one_step"] = within
        fields["keys_held"] = held
        return {"ok": True, "text": " ".join(parts), "fields": fields, "candidates": {}, "terminal": terminal, "realtime": True}


def build(game: Game):
    import warnings
    warnings.filterwarnings("ignore", message=".*lifespan.*")
    from mcp.server.mcpserver import MCPServer
    from mcp.types import ToolAnnotations

    m = MCPServer("mario", instructions=INSTRUCTIONS, log_level="WARNING")

    @m.tool(annotations=ToolAnnotations(readOnlyHint=True), description="Where Mario is and what is ahead, right now.")
    def observe() -> dict:
        return game.observe()

    @m.tool(description="Reload the game for a new run.")
    def reset(goal: str = "") -> dict:
        return game.reset(goal)

    # A key held for a moment changes nothing outside the game, so these are read-risk: gated as
    # writes (0.7) the model was refused three times mid-air at 0.40 to 0.59 and the run stopped.
    keys = {"risk": "read"}

    @m.tool(description="Hold right and run: Mario runs right, or keeps running, until the keys change.", meta=keys)
    def run_right() -> dict:
        return game.act("run_right")

    @m.tool(description="Hold right, run and jump: Mario leaves the ground if he is on it, and the longer jump stays held the higher he goes.", meta=keys)
    def jump_right() -> dict:
        return game.act("jump_right")

    @m.tool(description="Hold jump alone: a jump straight up, standing.", meta=keys)
    def jump() -> dict:
        return game.act("jump")

    @m.tool(description="Hold left: Mario walks left, to back away from something.", meta=keys)
    def walk_left() -> dict:
        return game.act("walk_left")

    @m.tool(annotations=ToolAnnotations(readOnlyHint=True), description="Let go of every key: Mario stops, and a held jump is released.")
    def wait() -> dict:
        return game.act("wait")

    return m


def main() -> int:
    game = Game()
    try:
        build(game).run("stdio")
    finally:
        try:
            if game._session is not None:
                game._run(game._session.kill(), 15)
        except Exception:  # noqa: BLE001
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
