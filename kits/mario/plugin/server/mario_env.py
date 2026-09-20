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
from typing import Annotated

from pydantic import Field

GAME_URL = os.environ.get("MARIO_URL", "https://supermarioplay.com/game/mario.html?v=1.0.1")
TILE = 8                      # game units per tile; the game draws a tile as 8 * unitsize px
HOLDS = {"short": 0.15, "medium": 0.35, "long": 0.6}
RUN_MOMENT = 0.15          # a run action holds the keys this long, then the model decides again
KEY = {"left": 37, "right": 39, "jump": 38, "down": 40, "sprint": 16}
ITEMS = {"Coin", "Mushroom", "FireFlower", "Star", "Vine", "Text", "Shell", "Fireball"}
INSTRUCTIONS = ("You play a side-scrolling platform game as Mario, deciding several times a second. Each step "
                "says where Mario is, whether he is on the ground, and what is ahead with distances in tiles. "
                "Keep moving right, and jump often: a running jump clears an enemy, a pipe or a gap and lands "
                "well past it, so jump_right whenever anything is within one step, held as long as the state "
                "says. A question block overhead within one step pays a coin: jump_right under it. In the air, "
                "run_right keeps the run going. Otherwise run right. When Mario has just died, wait. Finish when "
                "the level is cleared. Escalate when Mario has no lives left.")
# Measured on the live game, feet above the ground at the apex: a short hold reaches 3.1 tiles, a
# medium 3.9, a long 4.1, standing or at a run. So a 2-tile pipe takes a short hold, a 3-tile one a
# medium, and a 4-tile one a long hold with the run-up the jump_right macro provides (from against
# it the apex is level with the top and the side blocks the way; from 1.5 to 3 tiles back it clears).
def hold_for(height: float) -> str:
    return "short" if height <= 2 else "medium" if height <= 3 else "long"

TALL = 4          # a wall this tall needs the run-up
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
  var floors = (window.solids || []).filter(function(s){ return s.alive && s.title === 'Floor' && s.top >= p.bottom - 4; });
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
          screen_tiles: tiles(sr - sl), xvel: Math.round((p.xvel || 0) * 10) / 10, on_ground: !!p.resting, dead: !!p.dead,
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
        self._stopped_short = None # what a run stopped short of, for the result text
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

    async def _down(self, *codes: int) -> None:
        for c in codes:
            if c not in self._held:
                await self._eval(f"keydown({c}); 'ok'")
                self._held.add(c)

    async def _up(self, *codes: int) -> None:
        for c in codes:
            if c in self._held:
                await self._eval(f"keyup({c}); 'ok'")
                self._held.discard(c)

    async def _macro(self, name: str, hold: float) -> None:
        """The keys stay where a macro leaves them: running stays running between decisions, and a
        jump keeps the run key down for the whole flight. Releasing everything after each hold
        left Mario braking mid-air and landing short of the enemy he had jumped for (measured:
        five deaths in twenty-nine actions with released keys)."""
        R, S, U, L = KEY["right"], KEY["sprint"], KEY["jump"], KEY["left"]
        if name == "run_right":
            await self._up(L)
            await self._down(R, S)
            self._stopped_short = None
            t0 = time.time()
            while time.time() - t0 < RUN_MOMENT:
                await asyncio.sleep(0.03)
                st = await self._eval(STATE_JS)
                if not isinstance(st, dict) or not st.get("ready"):
                    continue
                w = (st.get("walls") or [None])[0]
                gap = (st.get("gaps") or [None])[0]
                if w and w["height"] >= TALL and w["dx"] <= 3.0:
                    # pressed against a tall pipe, a jump with the run key held rode up its side
                    # and left Mario embedded in it, "falling" in place (measured); the run stops
                    # where the jump's run-up starts
                    await self._up(R, S)
                    self._stopped_short = {"kind": f"{w['kind']} {w['height']} tiles tall"}
                    break
                if gap and gap["dx"] <= (1.5 if st.get("on_ground") else 2.5):
                    # a run carried into the gap after a landing beside it (recorded)
                    await self._up(R, S)
                    self._stopped_short = {"kind": "gap"}
                    break
        elif name == "jump_right":
            await self._up(L)
            await self._down(R, S)
            if not await self._eval("!!player.resting"):
                await asyncio.sleep(RUN_MOMENT)          # in the air a jump is a moment of running
                return
            await self._peel()
            await self._approach()
            await self._eval(f"keydown({U}); 'ok'")
            await asyncio.sleep(hold)
            await self._eval(f"keyup({U}); 'ok'")
        elif name == "jump":
            await self._up(R, S, L)
            await self._eval(f"keydown({U}); 'ok'")
            await asyncio.sleep(hold)
            await self._eval(f"keyup({U}); 'ok'")
        elif name == "walk_left":
            await self._up(R, S)
            await self._down(L)
            await asyncio.sleep(hold)
            await self._up(L)
        else:
            await self._up(R, S, L)
            await asyncio.sleep(0.25)

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

    async def _peel(self) -> None:
        """Overlapping a wall's edge (he stops a tenth of a tile inside it), a jump with the run key
        held rides up its side and embeds him. A short step back first, and the jump is a jump."""
        st = await self._eval(STATE_JS)
        w = ((st or {}).get("walls") or [None])[0] if isinstance(st, dict) else None
        if w and w["dx"] <= 0.05 and st.get("on_ground"):
            await self._up(KEY["right"], KEY["sprint"])
            await self._down(KEY["left"])
            await asyncio.sleep(0.12)
            await self._up(KEY["left"])
            await asyncio.sleep(0.1)
            await self._down(KEY["right"], KEY["sprint"])

    def _needed_hold(self) -> str | None:
        """The hold the nearest gap or wall within a step needs. A short hop into a gap and a
        medium jump at a 4-tile pipe each cost a life (measured), so the environment takes the
        hold the obstacle needs when the model's is shorter, and says so in the result."""
        st = self._run(self._eval(STATE_JS), 10)
        if not isinstance(st, dict) or not st.get("ready"):
            return None
        reach = max(1.0, abs(st.get("xvel") or 0) * 60 * 0.6 / (8 * 4))
        gaps, walls = st.get("gaps") or [], st.get("walls") or []
        if gaps and gaps[0]["dx"] <= reach + 0.5:
            return "long"
        if walls and walls[0]["dx"] <= reach + 0.5:
            return hold_for(walls[0]["height"])
        return None

    async def _approach(self) -> None:
        """The model decides to jump; where to leave the ground is the environment's, the way
        holding the keys is, for the two things a jump's timing decides. Measured on the live
        game: a wall 4 tiles tall is cleared only by a long jump at speed, taken 2.4 tiles back
        after a run-up (from against it the apex is level with the top, and from every standing
        distance the apex is 3.8); a gap is best left from its edge. Everything else is jumped
        where the model asked: a running jump lands nine tiles on, and standing beside an enemy
        to time anything cost more lives than it saved (recorded)."""
        st = await self._eval(STATE_JS)
        if not isinstance(st, dict) or not st.get("ready"):
            return
        target, want = self._target(st)
        if target is None:
            return
        R, S, L = KEY["right"], KEY["sprint"], KEY["left"]
        dx = self._distance(st, target)
        slow = abs(st.get("xvel") or 0) < 3
        if target == "wall" and slow and dx < want + 1.5 and st.get("on_ground"):
            # no room for the run-up: step back first, unless something is at his back
            if any(b["dx"] <= 3.5 for b in st.get("behind") or []):
                return
            await self._up(R, S)
            await self._down(L)
            for _ in range(70):
                await asyncio.sleep(0.03)
                st = await self._eval(STATE_JS)
                if not isinstance(st, dict) or st.get("dying") or st.get("dead"):
                    break
                if self._distance(st, target) >= want + 3.0:
                    break
            await self._up(L)
            await self._down(R, S)
            await asyncio.sleep(0.05)
        for _ in range(40):                        # at most 1.2 s of running
            await asyncio.sleep(0.03)
            st = await self._eval(STATE_JS)
            if not isinstance(st, dict) or st.get("dying") or st.get("dead"):
                return
            if self._distance(st, target) <= want:
                return

    @staticmethod
    def _distance(st: dict, kind: str) -> float:
        rows = st.get({"enemy": "enemies", "wall": "walls", "gap": "gaps", "block": "blocks"}[kind]) or []
        return rows[0]["dx"] if rows else 99.0

    @staticmethod
    def _target(st: dict):
        """What the jump's timing is for and the distance to leave the ground at: (kind, tiles),
        or (None, None) for a jump taken where the model asked."""
        walls, gaps, blocks = st.get("walls") or [], st.get("gaps") or [], st.get("blocks") or []
        near = []
        if walls and walls[0]["dx"] <= 6 and walls[0]["height"] >= TALL:
            near.append((walls[0]["dx"], "wall"))
        if gaps and gaps[0]["dx"] <= 6:
            near.append((gaps[0]["dx"], "gap"))
        if blocks and blocks[0]["dx"] <= 6:
            near.append((blocks[0]["dx"], "block"))
        if not near:
            return None, None
        dx, kind = min(near)
        fast = abs(st.get("xvel") or 0) >= 3
        if kind == "wall":
            return "wall", 2.4
        if kind == "block":
            # measured: at a run a medium jump started 1 to 1.5 tiles before the block hits it,
            # from 2 tiles or more it peaks short of it
            want = 1.3 if fast else 0.5
            return ("block", want) if dx > want else (None, None)
        return "gap", 1.5

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

    def act(self, name: str, hold: str) -> dict:
        seconds = HOLDS.get(hold, HOLDS["medium"])
        needed = self._needed_hold() if name == "jump_right" else None
        taken = needed if needed and HOLDS[needed] > seconds else None
        if taken:
            seconds = HOLDS[taken]

        async def go():
            await self._start()
            await self._macro(name, seconds)
            await asyncio.sleep(0.05)
            return await self._settled()
        st = self._run(go())
        self.steps += 1
        if name in ("run_right", "jump_right") and st.get("on_ground") and abs(st.get("xvel") or 0) < 0.5 and not st.get("dying"):
            self._stopped += 1
        else:
            self._stopped = 0
        d = self._describe(st)
        if name == "walk_left":
            self._stopped = 0
        short = self._stopped_short if name == "run_right" else None

        d["text"] = (f"{name} held {seconds:.2f} s" + (f" ({taken}: what lay ahead needed it)" if taken else "")
                     + (f", stopped short of the {short['kind']}" if short else "") + ". " + d["text"])
        return d

    def wait(self) -> dict:
        async def go():
            await self._start()
            await self._macro("wait", 0.25)
            return await self._settled()
        d = self._describe(self._run(go()))
        d["text"] = "Waited 0.25 s. " + d["text"]
        return d

    def _describe(self, st: dict) -> dict:
        if not st.get("ready"):
            return {"ok": True, "text": "The game is loading.", "fields": {"ready": False}, "candidates": {}, "terminal": False}
        restarting = self._restarting(st)
        if restarting:
            lives = st.get("lives")
            return {"ok": True, "text": f"Mario has just died. Lives left: {lives}. The level restarts from the beginning in a moment; wait.",
                    "fields": {"dead": True, "lives": lives, "restarting": True}, "candidates": {},
                    "terminal": bool(lives is not None and lives <= 0)}
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
            parts.append(f"Nearest enemy: {e['kind']} {e['dx']} tiles ahead, {where}, walking {'toward Mario' if e.get('dir') == 'toward' else 'away'}."
                         + (f" {len(en) - 1} more behind it." if len(en) > 1 else ""))
        else:
            parts.append("No enemy within 12 tiles ahead.")
        back = st.get("behind") or []
        if back:
            b = back[0]
            parts.append(f"Behind Mario: {b['kind']} {b['dx']} tiles back, walking {'toward him' if b.get('dir') == 'toward' else 'away'}.")
        gaps = st.get("gaps") or []
        parts.append(f"Gap in the ground: edge {gaps[0]['dx']} tiles ahead, {gaps[0]['width']} tiles wide." if gaps
                     else "No gap in the ground within 12 tiles.")
        walls = st.get("walls") or []
        if walls:
            w = walls[0]
            parts.append(f"Wall ahead: {w['kind']} {w['dx']} tiles ahead, {w['height']} tiles tall; "
                         f"jump_right held {hold_for(w['height'])} clears it.")
        else:
            parts.append("No pipe or wall within 8 tiles.")
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
        reach = round(max(1.0, abs(st.get("xvel") or 0) * 60 * 0.6 / (8 * 4)), 1)
        closing = round(reach + 1.5, 1)
        within = [f"the {en[0]['kind']} {en[0]['dx']} tiles ahead"] if en and en[0]["dx"] <= closing + 2.5 else []
        within += [f"the gap {gaps[0]['dx']} tiles ahead (hold long)"] if gaps and gaps[0]["dx"] <= reach + 0.5 else []
        within += [f"the {walls[0]['kind']} {walls[0]['dx']} tiles ahead (hold {hold_for(walls[0]['height'])})"] if walls and walls[0]["dx"] <= reach + 0.5 else []
        within += [f"the question block {blocks[0]['dx']} tiles ahead (hold medium)"] if blocks and blocks[0]["dx"] <= reach + 0.5 else []
        parts.append(f"One step reaches about {reach} tiles, and a walking enemy closes about {closing}. "
                     + (f"Within one step: {'; '.join(within)}." if within else "Nothing is within one step."))
        if self._stopped >= 2:
            parts.append(f"Mario has been stopped in place for {self._stopped} steps by something he is pressed "
                         "against: walk_left one step, then jump_right held long.")
        parts.append(f"Lives {st.get('lives')}, coins {st.get('coins')}, time {st.get('time')}, score {st.get('score')}.")
        terminal = bool(st.get("ending")) or (bool(st.get("dead")) and (st.get("lives") or 0) <= 0)
        fields = {k: st.get(k) for k in ("x", "y", "level_x", "on_ground", "dead", "xvel", "lives", "coins", "time", "score", "world")}
        fields["enemies"] = en
        fields["behind"] = st.get("behind") or []
        fields["gaps"] = gaps
        fields["walls"] = [{**w, "hold": hold_for(w["height"])} for w in walls]
        fields["blocks"] = blocks
        fields["stopped_steps"] = self._stopped
        fields["step_reach_tiles"] = reach
        fields["within_one_step"] = within
        return {"ok": True, "text": " ".join(parts), "fields": fields, "candidates": {}, "terminal": terminal}


def build(game: Game):
    import warnings
    warnings.filterwarnings("ignore", message=".*lifespan.*")
    from mcp.server.mcpserver import MCPServer
    from mcp.types import ToolAnnotations

    m = MCPServer("mario", instructions=INSTRUCTIONS, log_level="WARNING")
    Hold = Annotated[str, Field(description="How long to hold the keys.",
                                json_schema_extra={"oneOf": [{"const": "short", "description": "about 0.15 s, a small step or hop"},
                                                             {"const": "medium", "description": "about 0.35 s, a normal jump or stride"},
                                                             {"const": "long", "description": "about 0.6 s, the highest jump or a long run"}]})]

    @m.tool(annotations=ToolAnnotations(readOnlyHint=True), description="Where Mario is and what is ahead, right now.")
    def observe() -> dict:
        return game.observe()

    @m.tool(description="Reload the game for a new run.")
    def reset(goal: str = "") -> dict:
        return game.reset(goal)

    # A key held for a moment changes nothing outside the game, so these are read-risk: gated as
    # writes (0.7) the model was refused three times mid-air at 0.40 to 0.59 and the run stopped.
    keys = {"risk": "read"}

    @m.tool(description="Run to the right for a moment, and keep running until told otherwise.", meta=keys)
    def run_right() -> dict:
        return game.act("run_right", "medium")

    @m.tool(description="Jump while running right, over an enemy, a gap or a wall ahead; the run continues after the jump.", meta=keys)
    def jump_right(hold: Hold) -> dict:
        return game.act("jump_right", hold)

    @m.tool(description="Jump straight up, without moving.", meta=keys)
    def jump(hold: Hold) -> dict:
        return game.act("jump", hold)

    @m.tool(description="Walk to the left, to back away from something.", meta=keys)
    def walk_left(hold: Hold) -> dict:
        return game.act("walk_left", hold)

    @m.tool(annotations=ToolAnnotations(readOnlyHint=True), description="Let go of every key, stand still for a quarter second and look again.")
    def wait() -> dict:
        return game.wait()

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
