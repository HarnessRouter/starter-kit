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
KEY = {"left": 37, "right": 39, "jump": 38, "down": 40, "sprint": 16}
ITEMS = {"Coin", "Mushroom", "FireFlower", "Star", "Vine", "Text", "Shell", "Fireball"}
INSTRUCTIONS = ("You play a side-scrolling platform game as Mario. Each step says where Mario is, whether he is on "
                "the ground, and what is ahead with distances in tiles. One step lasts about half a second and "
                "covers up to 4 tiles at a run. Keep moving right. The state names any enemy, gap or wall that is "
                "within one step: jump over it now, with jump_right, held as long as the state says (a taller "
                "wall or a wider gap needs a longer hold). Otherwise run right. When Mario has just died, wait. "
                "Finish when the level is cleared. Escalate when Mario has no lives left.")
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
  var u = window.unitsize || 4, T = 8 * u, p = player, sl = gamescreen.left, sr = gamescreen.right;
  function tiles(px){ return Math.round(px / T * 10) / 10; }
  var enemies = [], gaps = [], walls = [];
  var ground = (window.map && map.floor) ? map.floor * u : p.bottom;   // the ground under him, not his feet: heights must not shrink mid-jump
  (window.characters || []).forEach(function(c){
    if (!c.alive || c === player || c.title === undefined) return;
    if (['Coin','Mushroom','FireFlower','Star','Vine','Text','Shell','Fireball'].indexOf(c.title) >= 0) return;
    var dx = (c.left - p.right) / T, dy = (p.bottom - c.bottom) / T;
    if (dx >= 0 && dx <= 12) enemies.push({kind: c.title, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10});
  });
  var floors = (window.solids || []).filter(function(s){ return s.alive && s.title === 'Floor' && s.top >= p.bottom - 4; });
  var x = p.right, gapStart = null;
  for (var i = 0; i <= 12 * T; i += T / 4) {
    var covered = floors.some(function(f){ return f.left <= x + i && x + i <= f.right; });
    if (!covered && gapStart === null) gapStart = i;
    if (covered && gapStart !== null) { gaps.push({dx: tiles(gapStart), width: tiles(i - gapStart)}); gapStart = null; }
  }
  if (gapStart !== null) gaps.push({dx: tiles(gapStart), width: tiles(12 * T - gapStart)});
  (window.solids || []).forEach(function(s){
    if (!s.alive || ['Pipe','Block','Brick','Stone'].indexOf(s.title) < 0) return;
    // anything whose far edge is still ahead of Mario counts, including the pipe he is pressed
    // against (he overlaps its edge by a tenth of a tile there, and a dx >= 0 filter lost it:
    // forty steps of "no wall within 8 tiles" against a pipe). A wall stands on the ground: what
    // sits at or below the ground is floor, and what floats a tile or more above it (the block
    // rows) is run under, not jumped
    if (s.right <= p.left || s.top >= ground - 2 || s.bottom < ground - T) return;
    var dx = Math.max(0, (s.left - p.right) / T);
    if (dx <= 8) walls.push({kind: s.title.toLowerCase(), dx: Math.round(dx * 10) / 10, height: tiles(ground - s.top)});
  });
  enemies.sort(function(a, b){ return a.dx - b.dx; }); walls.sort(function(a, b){ return a.dx - b.dx; }); gaps.sort(function(a, b){ return a.dx - b.dx; });
  walls = walls.filter(function(w, i){ return i === 0 || w.dx !== walls[i - 1].dx || w.height !== walls[i - 1].height; });
  var d = window.data || {};
  function amt(k){ return d[k] && d[k].amount !== undefined ? d[k].amount : null; }
  return {ready: true, x: tiles(p.left), y: tiles(ground - p.bottom),
          dying: !!p.dying,
          screen_tiles: tiles(sr - sl), xvel: Math.round((p.xvel || 0) * 10) / 10, on_ground: !!p.resting, dead: !!p.dead,
          power: p.power || 1, enemies: enemies.slice(0, 3), gaps: gaps.slice(0, 2), walls: walls.slice(0, 2),
          lives: amt('lives'), time: amt('time'), score: amt('score'), world: amt('world'), paused: !!window.paused,
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
            await asyncio.sleep(hold)
        elif name == "jump_right":
            await self._up(L)
            await self._down(R, S)
            await self._land()
            await self._approach()
            await self._eval(f"keydown({U}); 'ok'")
            await asyncio.sleep(hold)
            await self._eval(f"keyup({U}); 'ok'")
            await asyncio.sleep(max(0.0, 0.75 - hold))      # the flight, run key still down
        elif name == "jump":
            await self._up(R, S, L)
            await self._land()
            await self._eval(f"keydown({U}); 'ok'")
            await asyncio.sleep(hold)
            await self._eval(f"keyup({U}); 'ok'")
            await asyncio.sleep(max(0.0, 0.6 - hold))
        elif name == "walk_left":
            await self._up(R, S)
            await self._down(L)
            await asyncio.sleep(hold)
            await self._up(L)
        else:
            await self._up(R, S, L)
            await asyncio.sleep(0.25)

    async def _land(self) -> None:
        """A jump key pressed in the air does nothing in this game, so a jump asked for mid-flight
        is taken on landing: the action means what it says instead of being spent."""
        for _ in range(30):
            if await self._eval("!!player.resting || !!player.dead || !!player.dying"):
                return
            await asyncio.sleep(0.03)

    async def _approach(self) -> None:
        """The model decides to jump; when to leave the ground is the environment's, the way
        holding the keys is. A decision lands every half second or so and a jump is a one-tile
        affair, so a jump taken the moment it is chosen is early or late by luck. Measured on the
        live game: a wall 4 tiles tall is cleared by a long jump from 1.5 to 3 tiles back and from
        nowhere else (from against it the apex is level with the top; at a run from 4 back it
        peaks early and hits the side); a running jump covers about 9 tiles, so an enemy jumped
        from 4 tiles is landed well past, one jumped from 2 at a run is hit on take-off, and a gap
        is best left from its edge. So: keep running until the nearest thing ahead is at its
        distance, or, pressed against a tall wall with no speed, step back first."""
        st = await self._eval(STATE_JS)
        if not isinstance(st, dict) or not st.get("ready"):
            return
        target, want = self._target(st)
        if target is None:
            return
        R, S, L = KEY["right"], KEY["sprint"], KEY["left"]
        if target == "wall" and want is None:      # pressed against a tall wall, standing
            await self._up(R, S)
            await self._down(L)
            for _ in range(40):
                await asyncio.sleep(0.03)
                st = await self._eval(STATE_JS)
                w = ((st or {}).get("walls") or [None])[0]
                if not w or w["dx"] >= 1.6:
                    break
            await self._up(L)
            await self._down(R, S)
            await asyncio.sleep(0.05)
            return
        for _ in range(34):                        # at most a second of running
            await asyncio.sleep(0.03)
            st = await self._eval(STATE_JS)
            if not isinstance(st, dict) or st.get("dying") or st.get("dead"):
                return
            t, w = self._target(st)
            if t != target or w is None or self._distance(st, t) <= w:
                return

    @staticmethod
    def _distance(st: dict, kind: str) -> float:
        rows = st.get({"enemy": "enemies", "wall": "walls", "gap": "gaps"}[kind]) or []
        return rows[0]["dx"] if rows else 99.0

    @staticmethod
    def _target(st: dict):
        """What the jump is for and the distance to leave the ground at: (kind, tiles), with
        None tiles meaning jump now, and ("wall", None) meaning pressed against a tall wall."""
        near = []
        en, walls, gaps = st.get("enemies") or [], st.get("walls") or [], st.get("gaps") or []
        if en and en[0]["dx"] <= 10:
            near.append((en[0]["dx"], "enemy"))
        if walls and walls[0]["dx"] <= 6:
            near.append((walls[0]["dx"], "wall"))
        if gaps and gaps[0]["dx"] <= 6:
            near.append((gaps[0]["dx"], "gap"))
        if not near:
            return None, None
        dx, kind = min(near)
        fast = abs(st.get("xvel") or 0) >= 3
        if kind == "wall":
            if walls[0]["height"] < TALL:
                return None, None                       # any distance within a step clears it
            if dx < 1.4 and not fast and st.get("on_ground"):
                return "wall", None
            return "wall", 2.8
        if kind == "enemy":
            return ("enemy", 4.0) if fast and dx > 4.0 else (None, None)
        return ("gap", 1.5) if dx > 1.5 else (None, None)

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
        the floors are gone (the gap that is not there); an action during that window is spent."""
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
        if lives is not None:
            self._lives = lives
        if st.get("dead") or st.get("dying"):
            self._restarting_until = max(self._restarting_until, time.time() + 3.0)
        return time.time() < self._restarting_until

    def act(self, name: str, hold: str) -> dict:
        seconds = HOLDS.get(hold, HOLDS["medium"])

        async def go():
            await self._start()
            await self._macro(name, seconds)
            await asyncio.sleep(0.05)
            return await self._settled()
        st = self._run(go())
        self.steps += 1
        d = self._describe(st)
        d["text"] = f"{name} held {seconds:.2f} s. " + d["text"]
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
            parts.append(f"Nearest enemy: {e['kind']} {e['dx']} tiles ahead, {where}." + (f" {len(en) - 1} more behind it." if len(en) > 1 else ""))
        else:
            parts.append("No enemy within 12 tiles ahead.")
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
        parts.append(f"One step reaches about {reach} tiles, and a walking enemy closes about {closing}. "
                     + (f"Within one step: {'; '.join(within)}." if within else "Nothing is within one step."))
        parts.append(f"Lives {st.get('lives')}, time {st.get('time')}, score {st.get('score')}.")
        terminal = bool(st.get("ending")) or (bool(st.get("dead")) and (st.get("lives") or 0) <= 0)
        fields = {k: st.get(k) for k in ("x", "y", "on_ground", "dead", "xvel", "lives", "time", "score", "world")}
        fields["enemies"] = en
        fields["gaps"] = gaps
        fields["walls"] = [{**w, "hold": hold_for(w["height"])} for w in walls]
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

    @m.tool(description="Run to the right, and keep running until told otherwise.", meta=keys)
    def run_right(hold: Hold) -> dict:
        return game.act("run_right", hold)

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
