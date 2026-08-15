#!/usr/bin/env python3
"""Check scene.excalidraw against the contract the app and the export pipeline enforce.

A video board that is wrong in the wrong way does not fail loudly. The person opens
it and one card is a grey rectangle that never becomes a clip; or the timeline names
a shot that is still rendering and Export refuses at the end of a four-minute wait;
or the film comes out twelve seconds long when the storyboard promised eighteen. None
of that is visible from inside a turn, which is what this exists for.

Three families of rule live here, and each mirrors something real:

  * the SCENE rules mirror what Excalidraw's own restore() will accept and what the
    app's reader expects — the media element types, the customData shape, and the
    two things that break the canvas outright (a collaborators map that survived a
    JSON round trip, and a stored absolute URL that expires);
  * the TIMELINE rules mirror the export pipeline — order is the cut, every shot must
    be ready, in/out must lie inside the clip, and the planned duration is checked
    because the assembled duration is checked too;
  * the LAYOUT rules mirror what a person sees — media stacked on top of other media
    is a board nobody arranged.

If a rule here and the running system ever disagree, the running system is right and
this file is the bug. Two things this canNOT do: ask the gateway whether a job id is
real (only check_jobs knows), and see the live canvas. Hosted, the scene.excalidraw in
your workspace is a projection written after the last checkpoint, so it can be one
turn behind — describe_canvas is the authority, this file is the lint.

    python3 validate_scene.py [scene.excalidraw]
    python3 validate_scene.py scene.excalidraw --expect-seconds 24
    python3 validate_scene.py --templates templates/templates.json   # CI, every template

Exit 0 = it will render and it will export. Exit 1 = something is wrong.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys

SCENE_TYPE = "excalidraw"
SCENE_VERSION = 2

# Excalidraw's own element vocabulary. Anything outside it is dropped or drawn as nothing.
ELEMENT_TYPES = (
    "rectangle", "diamond", "ellipse", "text", "line", "arrow", "freedraw",
    "image", "frame", "magicframe", "embeddable", "iframe",
)
# Types that carry no area a person can collide with: a stroke may cross whatever it likes.
NO_OVERLAP_CHECK = ("line", "arrow", "freedraw", "frame", "magicframe")

MEDIA_KINDS = ("video", "image", "audio")
MEDIA_STATUS = ("running", "ready", "failed")
# Excalidraw has no video element. A clip is an embeddable whose renderer the app replaces;
# a still is a real image element bound to a files[] entry. Getting this backwards draws nothing.
ELEMENT_FOR_KIND = {"video": "embeddable", "audio": "embeddable", "image": "image"}

FPS_VALUES = (24, 25, 30)
RESOLUTIONS = ("1920x1080", "1080x1920", "1080x1080")
MAX_SHOTS = 40
MAX_TOTAL_S = 600
# The export job ffprobes its own output and fails if it drifts further than this from the plan.
# Checking the plan against itself here means that failure is not the first time anyone notices.
DURATION_TOLERANCE_S = 0.5
ASPECT_TOLERANCE = 0.02
# The document is written whole on every save. Past this it is slow, and past 4 MiB the write
# is refused outright.
SOFT_DOC_BYTES = 2 * 1024 * 1024
HARD_DOC_BYTES = 4 * 1024 * 1024

JOB_ID = re.compile(r"^mjob_[A-Za-z0-9_-]{4,}$")
MEDIA_ID = re.compile(r"^med_[A-Za-z0-9_-]{4,}$")
ABSOLUTE_URL = re.compile(r"[a-zA-Z][a-zA-Z0-9+.-]*://")

errors: list[str] = []
warnings: list[str] = []


def err(where: str, what: str, fix: str) -> None:
    errors.append(f"{where}: {what}\n    → {fix}")


def warn(where: str, what: str, fix: str) -> None:
    warnings.append(f"{where}: {what}\n    → {fix}")


def _num(v: object) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return float(v)


def _strings(node: object):
    """Every string anywhere under a node, for the URL sweep."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


# ── the scene envelope ────────────────────────────────────────────────────────────

def check_envelope(doc: dict) -> None:
    if doc.get("type") != SCENE_TYPE:
        err("type", f"is {json.dumps(doc.get('type'))}",
            f'a scene file says "type": "{SCENE_TYPE}" — without it Excalidraw refuses to open it')
    if doc.get("version") != SCENE_VERSION:
        err("version", f"is {json.dumps(doc.get('version'))}",
            f'set "version": {SCENE_VERSION}')
    if not isinstance(doc.get("elements"), list):
        err("elements", "is missing or not a list", '"elements": [] is an empty board, which is valid')
    if not isinstance(doc.get("appState"), dict):
        err("appState", "is missing or not an object",
            '"appState": {"viewBackgroundColor": "#ffffff", "zoom": {"value": 1}}')
    if not isinstance(doc.get("files"), dict):
        err("files", "is missing or not an object",
            '"files": {} — every still on the board is an entry here, keyed by its media id')

    app_state = doc.get("appState")
    if isinstance(app_state, dict):
        # THE canvas-killer. collaborators is a Map in memory; JSON turns it into {} and the
        # first render calls .forEach on it. The board goes white and nothing says why.
        if "collaborators" in app_state:
            err("appState.collaborators", "is present",
                "strip it on save and on load — it is a Map in memory, JSON makes it {}, and "
                "Excalidraw crashes calling .forEach on it")
        for k in ("selectedElementIds", "editingElement", "draggingElement", "selectedGroupIds"):
            if k in app_state:
                warn(f"appState.{k}", "is persisted",
                     "one person's selection is not part of the document; persist only "
                     "viewBackgroundColor, gridModeEnabled, scrollX, scrollY and zoom")

    meta = doc.get("meta")
    if meta is not None and not isinstance(meta, dict):
        err("meta", "is not an object", '"meta": {"title": "…"}')
    elif isinstance(meta, dict):
        if not str(meta.get("title") or "").strip():
            warn("meta.title", "is empty", "it is how this video is named in the list")
        if "rev" in meta and (not isinstance(meta["rev"], int) or isinstance(meta["rev"], bool)):
            err("meta.rev", f"is {json.dumps(meta['rev'])}", "rev is an integer the store maintains")


# ── media elements ────────────────────────────────────────────────────────────────

def check_media(el: dict, at: str, files: dict, template: bool) -> dict | None:
    """Validate one element's customData.media (or, in a template, its placeholder).

    Returns the normalised descriptor the timeline checks read, or None."""
    custom = el.get("customData")
    if not isinstance(custom, dict):
        return None
    media = custom.get("media")
    place = custom.get("placeholder")

    if media is not None and place is not None:
        err(f"{at}.customData", "carries both media and placeholder",
            "a placeholder is what a template ships before anything is generated; once a job is "
            "placed the element carries media and the placeholder is gone")
        return None

    if place is not None:
        if not template:
            err(f"{at}.customData.placeholder", "is a template placeholder in a real scene",
                "generate the shot and place its job, then remove the placeholder — a placeholder "
                "is never a clip and will never become one on its own")
            return None
        if not isinstance(place, dict):
            err(f"{at}.customData.placeholder", "is not an object",
                '{"v":1,"kind":"video","label":"Shot 1","seconds":6,"prompt":"…"}')
            return None
        if place.get("v") != 1:
            err(f"{at}.customData.placeholder.v", f"is {json.dumps(place.get('v'))}", 'set "v": 1')
        kind = place.get("kind")
        if kind not in MEDIA_KINDS:
            err(f"{at}.customData.placeholder.kind", f"is {json.dumps(kind)}",
                f"one of: {', '.join(MEDIA_KINDS)}")
            return None
        if not str(place.get("prompt") or "").strip():
            err(f"{at}.customData.placeholder", "has no prompt",
                "the prompt is the whole point of a template placeholder — it is what the agent "
                "adapts. A placeholder with no prompt is a grey box with a label")
        if not str(place.get("label") or "").strip():
            warn(f"{at}.customData.placeholder", "has no label",
                 'name the shot: "label": "Shot 1"')
        secs = _num(place.get("seconds"))
        if kind != "image" and (secs is None or secs <= 0):
            err(f"{at}.customData.placeholder.seconds", f"is {json.dumps(place.get('seconds'))}",
                "a template states the length it was written for — a duration is required on "
                "every clip and one model bills 15 s when it is missing")
        if "mediaId" in place or "jobId" in place:
            err(f"{at}.customData.placeholder", "names a job or a media id",
                "a template ships nothing that was generated; those appear when the agent places "
                "a real job")
        return {"kind": kind, "status": "placeholder", "seconds": secs,
                "label": place.get("label"), "width": None, "height": None}

    if media is None:
        return None

    if not isinstance(media, dict):
        err(f"{at}.customData.media", "is not an object",
            "the tools write this; if you hand-edited it, stop — use place/move/arrange/remove")
        return None

    if media.get("v") != 1:
        err(f"{at}.customData.media.v", f"is {json.dumps(media.get('v'))}", 'set "v": 1')

    kind = media.get("kind")
    if kind not in MEDIA_KINDS:
        err(f"{at}.customData.media.kind", f"is {json.dumps(kind)}",
            f"one of: {', '.join(MEDIA_KINDS)}")
        return None

    status = media.get("status")
    if status not in MEDIA_STATUS:
        err(f"{at}.customData.media.status", f"is {json.dumps(status)}",
            f"one of: {', '.join(MEDIA_STATUS)}")
        return None

    want_type = ELEMENT_FOR_KIND[kind]
    if el.get("type") != want_type:
        err(at, f'is of type "{el.get("type")}" but carries {kind} media',
            f'{kind} media belongs on an element of type "{want_type}". Excalidraw has no video '
            "element at all: a clip is an embeddable whose renderer the app replaces, and a still "
            "is an image bound to files[]")

    job = media.get("jobId")
    if not isinstance(job, str) or not JOB_ID.match(job):
        err(f"{at}.customData.media.jobId", f"is {json.dumps(job)}",
            "every placed element names the job that made it, as mjob_… — without it nothing can "
            "tell you why it failed")

    mid = media.get("mediaId")
    if status == "ready":
        if not isinstance(mid, str) or not MEDIA_ID.match(mid):
            err(f"{at}.customData.media.mediaId", f"is {json.dumps(mid)} on a ready element",
                "a ready element has its media stored: med_…. If the render landed and this is "
                "still null the element will draw nothing")
        if kind == "image":
            fid = el.get("fileId")
            if fid != mid:
                err(f"{at}.fileId", f"is {json.dumps(fid)} but the media id is {json.dumps(mid)}",
                    "the fileId IS the media id. addFiles will not update a fileId that already "
                    "exists, so a placeholder that keeps its old id never becomes the new frame")
            elif fid not in files:
                err(f"files[{fid}]", "is missing",
                    "an image element draws from files[fileId]; without the entry the frame is blank")
    elif mid not in (None, ""):
        err(f"{at}.customData.media.mediaId", f"is set on a {status} element",
            "media exists only once the render has landed and been stored")

    for k in ("seconds", "width", "height"):
        if media.get(k) is not None and _num(media.get(k)) is None:
            err(f"{at}.customData.media.{k}", f"is {json.dumps(media.get(k))}", "it is a number")
    if kind == "video" and status == "ready" and _num(media.get("seconds")) is None:
        err(f"{at}.customData.media.seconds", "is missing on a ready clip",
            "the length is measured from the file when it lands; the timeline is summed from it "
            "and an export cannot be planned without it")

    if not str(media.get("model") or "").strip():
        warn(f"{at}.customData.media", "does not say which model made it",
             "the chain picks the model, so the element is the only record of which one ran")
    if not str(media.get("prompt") or "").strip():
        warn(f"{at}.customData.media", "does not carry its prompt",
             "without it nobody can tell what this shot was asked to be, including you next turn")

    # Invariant: the provider URL is never persisted. Every one of them expires — happyhorse's in
    # about a day, every kling and seedream URL is signed — and the stored copy does not.
    for s in _strings(media):
        if ABSOLUTE_URL.search(s):
            err(f"{at}.customData.media", "contains an absolute URL",
                "never store a provider URL: it expires and the board dies with it. The media is "
                "in the store and the app derives its address from mediaId at render time")
            break
    link = el.get("link")
    if isinstance(link, str) and ABSOLUTE_URL.search(link):
        err(f"{at}.link", "is an absolute URL on a media element",
            "a clip's link is a same-origin path derived from its media id — an absolute one "
            "breaks the moment this deployment's address changes")

    return {"kind": kind, "status": status, "seconds": _num(media.get("seconds")),
            "label": media.get("label"), "width": _num(media.get("width")),
            "height": _num(media.get("height"))}


def check_elements(doc: dict, template: bool) -> dict[str, dict]:
    elements = doc.get("elements") or []
    files = doc.get("files") or {}
    seen: set[str] = set()
    info: dict[str, dict] = {}
    boxes: list[tuple] = []
    frames: set[str] = set()

    for i, el in enumerate(elements):
        at = f"elements[{i}]"
        if not isinstance(el, dict):
            err(at, "is not an object", "every element is a JSON object")
            continue
        eid = el.get("id")
        if not isinstance(eid, str) or not eid.strip():
            err(at, "has no id", "every element carries a stable id; the timeline references it")
            continue
        at = f"elements[{eid}]"
        if eid in seen:
            err(at, "reuses an id", "element ids are unique — a duplicate makes moves land on the "
                                    "wrong one")
        seen.add(eid)

        etype = el.get("type")
        if etype not in ELEMENT_TYPES:
            err(at, f"is of type {json.dumps(etype)}",
                f"Excalidraw draws only: {', '.join(ELEMENT_TYPES)}")
            continue
        if etype in ("frame", "magicframe"):
            frames.add(eid)
            if not str(el.get("name") or "").strip():
                warn(at, "is an unnamed frame",
                     "a frame is a shot; its name is what the person reads and how the timeline "
                     "is ordered in the storyboard layout")

        geom = {k: _num(el.get(k)) for k in ("x", "y", "width", "height")}
        missing = [k for k, v in geom.items() if v is None]
        if missing:
            err(at, f"has no numeric {', '.join(missing)}",
                "every element has x, y, width and height as numbers")
            continue
        if geom["width"] <= 0 or geom["height"] <= 0:
            err(at, "has zero or negative size", "an element with no area is invisible")

        if el.get("isDeleted"):
            continue

        desc = check_media(el, at, files, template)
        if desc:
            info[eid] = desc

        if etype not in NO_OVERLAP_CHECK and not el.get("containerId"):
            boxes.append((geom["x"], geom["y"], geom["width"], geom["height"],
                          el.get("frameId"), at, bool(desc)))

    for j, (x, y, w, h, fr, at, is_media) in enumerate(boxes):
        for (ox, oy, ow, oh, ofr, oat, o_media) in boxes[j + 1:]:
            if not (x < ox + ow and ox < x + w and y < oy + oh and oy < y + h):
                continue
            if fr and ofr and fr == ofr:
                warn(f"{at}.layout", f"overlaps {oat} inside the same shot",
                     "a caption sits under its clip, not over it — call arrange rather than "
                     "computing coordinates by hand")
            elif is_media or o_media:
                err(f"{at}.layout", f"overlaps {oat}",
                    "media stacked on media is a board nobody arranged, and the one underneath is "
                    "unreachable — call arrange(layout: \"storyboard\")")
            else:
                warn(f"{at}.layout", f"overlaps {oat}", "call arrange to pack the board")

    for eid, d in info.items():
        fr = next((e for e in elements if isinstance(e, dict) and e.get("id") == eid), {})
        parent = fr.get("frameId")
        if parent and parent not in frames:
            err(f"elements[{eid}].frameId", f"names {json.dumps(parent)}, which is not a frame",
                "a child of a frame that does not exist is dragged loose from its shot")

    # Files nobody draws, and files big enough to threaten the write cap.
    drawn = {e.get("fileId") for e in elements
             if isinstance(e, dict) and not e.get("isDeleted") and e.get("fileId")}
    for fid, f in (doc.get("files") or {}).items():
        if not isinstance(f, dict):
            err(f"files[{fid}]", "is not an object", '{"id": "…", "mimeType": "…", "dataURL": "…"}')
            continue
        url = f.get("dataURL")
        if not isinstance(url, str) or not url:
            err(f"files[{fid}].dataURL", "is missing", "it is where the image is read from")
        elif url.startswith("data:"):
            owner = next((e for e in elements if isinstance(e, dict) and e.get("fileId") == fid
                          and isinstance(e.get("customData"), dict)
                          and isinstance(e["customData"].get("media"), dict)), None)
            if owner is not None:
                err(f"files[{fid}].dataURL", "is a data: URI on generated media",
                    "generated stills are stored once and addressed by media id; inlining them "
                    "rewrites megabytes on every save and blows the 4 MiB write cap")
            elif len(url) > 512 * 1024:
                warn(f"files[{fid}].dataURL", f"is an inline image of {len(url) // 1024} KB",
                     "the whole document is rewritten on every save; large pasted images make "
                     "every keystroke expensive")
        elif ABSOLUTE_URL.search(url):
            err(f"files[{fid}].dataURL", "is an absolute URL",
                "it is a same-origin path so the browser sends the console's own session with it; "
                "an absolute one breaks when this deployment's address changes")
        if fid not in drawn:
            warn(f"files[{fid}]", "is drawn by no element",
                 "delete it, or place the media it belongs to — it is dead weight in every save")

    return info


# ── the timeline ──────────────────────────────────────────────────────────────────

def check_timeline(doc: dict, info: dict[str, dict], template: bool,
                   expect_seconds: float | None) -> None:
    tl = doc.get("timeline")
    if tl is None:
        if info:
            warn("timeline", "is absent",
                 "the board has media on it but nothing says what order it cuts in — call "
                 "set_timeline before export. Order is never guessed from where cards sit")
        return
    if not isinstance(tl, dict):
        err("timeline", "is not an object",
            '{"v":1,"fps":30,"resolution":"1920x1080","shots":[…],"audio":[…]}')
        return

    if tl.get("v") != 1:
        err("timeline.v", f"is {json.dumps(tl.get('v'))}", 'set "v": 1')
    fps = tl.get("fps")
    if fps not in FPS_VALUES:
        err("timeline.fps", f"is {json.dumps(fps)}",
            f"one of: {', '.join(str(f) for f in FPS_VALUES)}")
    res = tl.get("resolution")
    if res not in RESOLUTIONS:
        err("timeline.resolution", f"is {json.dumps(res)}", f"one of: {', '.join(RESOLUTIONS)}")
    target_aspect = None
    if isinstance(res, str) and res in RESOLUTIONS:
        rw, rh = (float(v) for v in res.split("x"))
        target_aspect = rw / rh

    shots = tl.get("shots")
    if not isinstance(shots, list) or not shots:
        err("timeline.shots", "is missing or empty",
            "a film is at least one shot; the array order IS the cut order")
        return
    if len(shots) > MAX_SHOTS:
        err("timeline.shots", f"has {len(shots)} shots",
            f"export takes at most {MAX_SHOTS}; this is two films")

    total = 0.0
    used: set[str] = set()
    for i, s in enumerate(shots):
        at = f"timeline.shots[{i}]"
        if not isinstance(s, dict):
            err(at, "is not an object", '{"elementId":"el_…","inS":0,"outS":6}')
            continue
        eid = s.get("elementId")
        if not isinstance(eid, str) or not eid.strip():
            err(at, "has no elementId", "a shot names the element on the board that it cuts")
            continue
        d = info.get(eid)
        if d is None:
            err(at, f"names {eid}, which is not media on this board",
                "a shot that points at nothing is a gap the export cannot fill — every shot is an "
                "element you placed")
            continue
        if d["kind"] != "video":
            err(at, f"names a {d['kind']}, not a clip",
                "shots are clips. Narration and music go in timeline.audio, where they get a "
                "start time and a level")
            continue
        if eid in used:
            warn(at, f"uses {eid} a second time",
                 "the same clip twice is legal and occasionally deliberate; if it was not, one of "
                 "these is the shot you forgot to generate")
        used.add(eid)

        if d["status"] == "running":
            err(at, "is still rendering",
                "export refuses until every shot has landed. Call check_jobs and wait — the "
                "sweeper finishes it even if you do not")
        elif d["status"] == "failed":
            err(at, "failed to render",
                "read its error with check_jobs, then generate the shot again and place the new "
                "job in its position")
        elif d["status"] != "ready" and not template:
            err(at, f"is {d['status']}", "every shot in an exported timeline is ready")

        clip = d["seconds"]
        in_s = _num(s.get("inS")) if s.get("inS") is not None else 0.0
        out_s = _num(s.get("outS")) if s.get("outS") is not None else clip
        if in_s is None or out_s is None:
            err(at, "has a non-numeric in or out point",
                "inS and outS are seconds from the start of the clip")
            continue
        if in_s < 0:
            err(at, f"starts at {in_s}s", "a clip starts at 0")
        if out_s <= in_s:
            err(at, f"runs from {in_s}s to {out_s}s",
                "outS is after inS — a zero-length shot contributes nothing and the assembled "
                "duration will not match the plan")
            continue
        if clip is not None and out_s > clip + 1e-6:
            err(at, f"cuts to {out_s}s of a {clip}s clip",
                "trim inside the clip; ffmpeg will stop at the end of the file and the film comes "
                "out short")
            continue
        total += out_s - in_s

        w, h = d["width"], d["height"]
        if target_aspect and w and h and abs((w / h) - target_aspect) > ASPECT_TOLERANCE:
            warn(at, f"is {int(w)}x{int(h)} in a {res} timeline",
                 "it is letterboxed into the frame — black bars nobody asked for. Pick one aspect "
                 "at the start and generate every shot for it")

    if total > MAX_TOTAL_S:
        err("timeline", f"is {total:.1f}s long",
            f"export takes at most {MAX_TOTAL_S}s in one film")

    audio = tl.get("audio")
    if audio is not None:
        if not isinstance(audio, list):
            err("timeline.audio", "is not a list", '[{"elementId":"el_…","startS":0,"gainDb":-6}]')
        else:
            for i, a in enumerate(audio):
                at = f"timeline.audio[{i}]"
                if not isinstance(a, dict):
                    err(at, "is not an object", '{"elementId":"el_…","startS":0,"gainDb":0}')
                    continue
                eid = a.get("elementId")
                d = info.get(eid) if isinstance(eid, str) else None
                if d is None:
                    err(at, f"names {json.dumps(eid)}, which is not media on this board",
                        "narration is an element you generated and placed, like any other")
                    continue
                if d["kind"] != "audio":
                    err(at, f"names a {d['kind']}", "only audio goes on the audio track")
                start = _num(a.get("startS")) if a.get("startS") is not None else 0.0
                if start is None or start < 0:
                    err(at, f"starts at {json.dumps(a.get('startS'))}",
                        "startS is seconds from the beginning of the film, and is never negative")
                elif start > total:
                    warn(at, f"starts at {start}s in a {total:.1f}s film",
                         "it will never be heard")
                gain = _num(a.get("gainDb")) if a.get("gainDb") is not None else 0.0
                if gain is None or not (-40 <= gain <= 6):
                    err(at, f"has gain {json.dumps(a.get('gainDb'))}",
                        "gainDb is between -40 and 6; under a voice, music sits around -12 to -18")

    if expect_seconds is not None:
        drift = abs(total - expect_seconds)
        if drift > DURATION_TOLERANCE_S:
            err("timeline", f"totals {total:.2f}s, and the plan said {expect_seconds:.2f}s",
                f"that is {drift:.2f}s of drift. The export ffprobes its own output against this "
                "number and fails, so reconcile it now: either a shot rendered at a length you did "
                "not ask for, or the storyboard changed and nobody told the person")
        else:
            print(f"timeline totals {total:.2f}s against a planned {expect_seconds:.2f}s "
                  f"({drift:.2f}s drift).")
    elif shots:
        print(f"timeline is {len(shots)} shot(s), {total:.2f}s at {tl.get('fps')} fps, {res}.")


# ── driver ────────────────────────────────────────────────────────────────────────

def validate(doc: object, template: bool, expect_seconds: float | None) -> None:
    if not isinstance(doc, dict):
        err("scene", "is not a JSON object", "a scene file is one object")
        return
    check_envelope(doc)
    info = check_elements(doc, template)
    check_timeline(doc, info, template, expect_seconds)

    size = len(json.dumps(doc))
    if size > HARD_DOC_BYTES:
        err("scene", f"is {size // 1024} KB",
            f"the document is written whole on every save and refused past "
            f"{HARD_DOC_BYTES // 1024 // 1024} MiB — the media itself never belongs in it")
    elif size > SOFT_DOC_BYTES:
        warn("scene", f"is {size // 1024} KB",
             "it is rewritten on every save; check nothing binary has been inlined")

    running = [k for k, v in info.items() if v["status"] == "running"]
    if running and not template:
        print(f"{len(running)} element(s) still rendering — check_jobs will tell you when they land.")


def report(label: str) -> int:
    if errors:
        print(f"{label}: {len(errors)} problem(s):\n")
        for e in errors:
            print("  ✗ " + e)
    if warnings:
        print(f"\n{label}: {len(warnings)} warning(s):\n")
        for w in warnings:
            print("  ! " + w)
    if not errors:
        print(f"{label} is valid." + (" Review the warnings above." if warnings else ""))
        print("This cannot ask whether a job id is real, and hosted it may be reading a scene one "
              "turn old. check_jobs and describe_canvas are the authority.")
    return 1 if errors else 0


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True, description=__doc__.split("\n")[0])
    ap.add_argument("scene", nargs="?", default="scene.excalidraw")
    ap.add_argument("--template", action="store_true",
                    help="the scene is a template: placeholders instead of generated media")
    ap.add_argument("--expect-seconds", type=float, default=None,
                    help="the total length the storyboard promised; drift over "
                         f"{DURATION_TOLERANCE_S}s is an error")
    ap.add_argument("--templates", default=None,
                    help="validate every templates[].scene in a templates.json (CI)")
    args = ap.parse_args()

    if args.templates:
        try:
            with open(args.templates) as fh:
                lib = json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            print(f"{args.templates}: {e}")
            return 1
        tpls = lib.get("templates") if isinstance(lib, dict) else lib
        if not isinstance(tpls, list) or not tpls:
            print(f"{args.templates} has no templates[].")
            return 1
        rc = 0
        for t in tpls:
            errors.clear()
            warnings.clear()
            tid = (t or {}).get("id", "?")
            scene = (t or {}).get("scene")
            if scene is None:
                print(f"templates[{tid}]: has no scene — a template the agent copies from must be "
                      "a real, valid scene")
                rc = 1
                continue
            validate(scene, template=True, expect_seconds=None)
            rc |= report(f"templates[{tid}].scene")
            print()
        return rc

    try:
        with open(args.scene) as fh:
            doc = json.load(fh)
    except FileNotFoundError:
        print(f"{args.scene} does not exist.\n"
              "    → On a new video it simply has not been written yet: place something on the "
              "canvas and it appears. Do NOT create it by hand — the canvas is not a file you write.")
        return 1
    except json.JSONDecodeError as e:
        print(f"{args.scene} is not valid JSON: {e}\n"
              f"    → line {e.lineno}, column {e.colno}. If you edited it, stop — the canvas tools "
              "own this file and your edits to it are discarded anyway.")
        return 1

    validate(doc, template=args.template, expect_seconds=args.expect_seconds)
    return report(args.scene)


if __name__ == "__main__":
    sys.exit(main())
