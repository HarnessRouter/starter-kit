#!/usr/bin/env python3
"""The platform client the calibration scripts share: start a run on the inner harness, wait for
it, fetch its workspace, read and write the harness. Credentials: HR_API_URL and
HR_CALIBRATION_TOKEN (a per-turn credential scoped to the inner harness); for a self-hosted box
in development, HR_AUTH_USER and HR_AUTH_PASSWORD log in instead."""
import io
import json
import os
import sys
import time
import urllib.request
import urllib.error
import http.cookiejar
import zipfile

API = os.environ.get("HR_API_URL", "").rstrip("/")
TOKEN = os.environ.get("HR_CALIBRATION_TOKEN", "")
HARNESS = os.environ.get("HR_INNER_HARNESS", "")

_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))
_logged_in = False


def _url(path: str) -> str:
    base = API
    if not base:
        sys.exit("HR_API_URL is not set")
    if path.startswith("/v1/") and "/api/harness" not in base and not base.endswith("/v1") and os.environ.get("HR_AUTH_USER"):
        base = base + "/api/harness"      # the self-hosted console's mount of the API
    return base + path


def _login() -> None:
    global _logged_in
    if _logged_in or TOKEN or not os.environ.get("HR_AUTH_USER"):
        return
    body = json.dumps({"username": os.environ["HR_AUTH_USER"], "password": os.environ["HR_AUTH_PASSWORD"]}).encode()
    req = urllib.request.Request(API + "/api/selfhost/login", data=body, headers={"content-type": "application/json"}, method="POST")
    _opener.open(req, timeout=60).read()
    _logged_in = True


def call(method: str, path: str, body=None, raw: bool = False, timeout: int = 120):
    _login()
    headers = {"content-type": "application/json", "accept": "application/json" if not raw else "*/*"}
    if TOKEN:
        headers["authorization"] = f"Bearer {TOKEN}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(_url(path), data=data, headers=headers, method=method)
    try:
        with _opener.open(req, timeout=timeout) as r:
            payload = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> {e.code}: {e.read()[:300].decode(errors='replace')}")
    return payload if raw else (json.loads(payload) if payload else {})


def start_run(goal: str, harness: str | None = None, model: str | None = None, script: list[str] | None = None,
              max_step: int | None = None, timeout_seconds: int | None = None) -> dict:
    """Start one run in the background; returns the response object."""
    meta = {"harness_id": harness or HARNESS}
    if script:
        meta["systemone"] = {"script": list(script)}
    body = {"input": goal, "metadata": meta, "background": True, "store": True}
    if model:
        body["model"] = model
    if max_step:
        body["max_step"] = max_step
    if timeout_seconds:
        body["timeout_seconds"] = timeout_seconds
    return call("POST", "/v1/responses", body)


TERMINAL = ("completed", "failed", "incomplete", "cancelled")


def wait_run(response_id: str, poll: float = 5.0, limit: float = 3600.0) -> dict:
    """Blocks until the run has ended. Only a terminal status ends the wait: a server may say
    `running` or `queued` for work in progress, and treating anything but `in_progress` as done
    started three runs at once on one machine (2026-09-21)."""
    t0 = time.time()
    while True:
        r = call("GET", f"/v1/responses/{response_id}")
        if r.get("status") in TERMINAL:
            return r
        if time.time() - t0 > limit:
            sys.exit(f"run {response_id} still not finished after {limit:.0f}s")
        time.sleep(poll)


def session_of(response: dict) -> str | None:
    """The session the response ran in: named on the response, or else the inner harness's newest session."""
    meta = response.get("metadata") or {}
    sid = meta.get("session_id") or response.get("session_id") or meta.get("harness_session_id")
    if sid:
        return sid
    listing = call("GET", f"/v1/sessions?harness={HARNESS}&limit=1")
    sessions = listing.get("sessions") or []
    return sessions[0].get("session_id") if sessions else None


def fetch_workspace(session_id: str, out_dir: str) -> dict:
    """The session's files as one archive, unpacked; returns the paths of trace.json and observations/."""
    os.makedirs(out_dir, exist_ok=True)
    blob = call("GET", f"/v1/sessions/{session_id}/files/archive", raw=True, timeout=600)
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        z.extractall(out_dir)
    trace = None
    obs = None
    for root, dirs, files in os.walk(out_dir):
        if "trace.json" in files and trace is None:
            trace = os.path.join(root, "trace.json")
        if os.path.basename(root) == "observations" and obs is None:
            obs = root
    return {"trace": trace, "observations": obs, "dir": out_dir}


def get_harness(harness: str | None = None) -> dict:
    return call("GET", f"/v1/harnesses/{harness or HARNESS}")


def put_harness(body: dict, harness: str | None = None) -> dict:
    return call("PUT", f"/v1/harnesses/{harness or HARNESS}", body)


if __name__ == "__main__":
    print(json.dumps(get_harness(sys.argv[1] if len(sys.argv) > 1 else None), indent=1)[:2000])
