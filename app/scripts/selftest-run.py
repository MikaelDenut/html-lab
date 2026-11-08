#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import plistlib
import local_config
import re
import subprocess
import sys
import time

HOSTS = {
    "intel": local_config.value("intel"),
    "mini": local_config.value("mini"),
}
DEST = "/tmp/HTML Lab Test.app"
LOGS = "~/Library/Logs/fi.cyborvent.htmllab"
APP_DIR = pathlib.Path(__file__).resolve().parent.parent


def build_of(app):
    info = plistlib.loads((pathlib.Path(app) / "Contents/Info.plist").read_bytes())
    return info.get("CFBundleShortVersionString", "unknown"), info.get("HTMLLabRevision") or "unstamped"


def run_kind(smoke, only):
    if smoke:
        return "smoke"
    if only == "all":
        return "selftest"
    return "only-" + (re.sub(r"[^A-Za-z0-9]+", "-", only).strip("-") or "blank")


def history_file(version, revision, host, kind, root=APP_DIR):
    return root / "test-history" / f"{version}-{revision}" / f"{host}-{kind}.json"


def pinned_minimum(smoke, root=APP_DIR):
    name, key = ("smoke-test.js", "MIN_STEPS") if smoke else ("self-test.js", "MIN_TESTS")
    try:
        found = re.search(rf"export const {key} = (\d+);", (root / "ui" / name).read_text())
    except OSError:
        return None
    return int(found.group(1)) if found else None


def problems(report, smoke, only, fallback_minimum=None, clip=None):
    found = []
    rows = report.get("results")
    if not isinstance(rows, list):
        return ["the report has no list of results"]
    failed = [r for r in rows if not r.get("ok")]
    if failed:
        found.append(f"{len(failed)} of {len(rows)} failed")
    if (report.get("total"), report.get("failed")) != (len(rows), len(failed)):
        found.append(f"the report says total {report.get('total')}, failed {report.get('failed')}, "
                     f"but its rows are {len(rows)} with {len(failed)} failed")
    tests = [r for r in rows if not str(r.get("name", "")).endswith(" (cleanup)")]
    if not tests:
        found.append("no tests ran" + (f": --only {only!r} matches no test name" if only != "all" else ""))
    if smoke or only == "all":
        key = "minSteps" if smoke else "minTests"
        least = report.get(key) or fallback_minimum
        if not least:
            found.append(f"no pinned minimum: the report has no {key} and the test source pins none")
        elif len(tests) < least:
            found.append(f"{len(tests)} {'steps' if smoke else 'tests'} ran, the pinned minimum is {least}: "
                         "some stopped being registered")
    errors = report.get("errors") or []
    if errors:
        found.append(f"{len(errors)} script errors, the first: {str(errors[0]).splitlines()[0][:300]}")
    if report.get("lastCopied") is not None and clip != report["lastCopied"]:
        found.append(f"the clipboard there holds {len(clip or '')} characters, not the "
                     f"{len(report['lastCopied'])} that Help's Copy copied")
    if smoke:
        unshot = [r["name"] for r in rows if not r.get("shot")]
        if unshot:
            found.append(f"{len(unshot)} steps have no picture: {', '.join(unshot)[:300]}")
    return found


def kept_report(report, found, build):
    kept = dict(report, runner={**build, "verdict": "NOT PASSED" if found else "PASS", "problems": found})
    if found:
        kept["appCounts"] = {k: report.get(k) for k in ("total", "passed", "failed")}
        rows = list(report.get("results") or [])
        rows.append({"name": "selftest-run.py: the runner's own checks", "ok": False, "error": "; ".join(found)})
        failed = sum(1 for r in rows if not r.get("ok"))
        kept.update(results=rows, total=len(rows), passed=len(rows) - failed, failed=failed)
    return kept


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("app")
    ap.add_argument("--host", default="intel", choices=HOSTS)
    ap.add_argument("--only", default="all")
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    version, revision = build_of(args.app)
    print(f"HTML Lab {version} at {revision}"
          + ("  (UNSTAMPED: this build has no HTMLLabRevision, so it cannot be traced to a commit)"
             if revision == "unstamped" else ""))
    ssh_cmd = ["ssh", "-4", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "LogLevel=ERROR", HOSTS[args.host]]

    def ssh(command, check=False):
        done = subprocess.run(ssh_cmd + [command], capture_output=True, text=True)
        if check and done.returncode:
            put_prefs_back()
            sys.exit(f"ssh failed ({done.returncode}): {command}\n{done.stderr.strip()}")
        return done.stdout

    report_name = "smoke-latest.json" if args.smoke else "selftest-latest.json"
    prefs = "~/Library/Application\\ Support/fi.cyborvent.htmllab"

    def put_prefs_back(stop_app=False):
        if args.smoke:
            stop = f"pkill -f '{DEST}'; " if stop_app else ""
            subprocess.run(ssh_cmd + [f"{stop}test -f {prefs}/prefs.json.smoke-aside && "
                                      f"mv {prefs}/prefs.json.smoke-aside {prefs}/prefs.json; true"],
                           capture_output=True, text=True)

    shots_gone = f"find {LOGS} -name 'smoke-*.png' -delete 2>/dev/null"
    left = ssh(f"rm -rf '{DEST}'; rm -f {LOGS}/{report_name}; {shots_gone}; "
               f"test -f {LOGS}/{report_name} && echo STALE; true", check=True)
    if "STALE" in left:
        sys.exit(f"the old {report_name} there could not be removed, so this run's report could not be told apart")
    if args.smoke:
        ssh(f"test -f {prefs}/prefs.json && mv {prefs}/prefs.json {prefs}/prefs.json.smoke-aside; true", check=True)
    parent, name = os.path.split(args.app.rstrip("/"))
    pack = subprocess.Popen(["tar", "-C", parent, "-cf", "-", "-s", f",^{name},HTML Lab Test.app,", name],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    subprocess.run(ssh_cmd + ["tar -C /tmp -xf - 2>/dev/null"], stdin=pack.stdout, check=True)
    if pack.wait():
        put_prefs_back()
        sys.exit("packing the app failed, so the copy there is not whole")
    if args.smoke:
        flag = "--smoke-test"
    else:
        flag = "--self-test" if args.only == "all" else f"--self-test={args.only}"
    ssh(f"xattr -cr '{DEST}'; open -n '{DEST}' --args {flag}", check=True)
    kind = run_kind(args.smoke, args.only)
    kept = history_file(version, revision, args.host, kind)
    kept.parent.mkdir(parents=True, exist_ok=True)
    build = {"version": version, "revision": revision, "host": args.host, "kind": kind,
             "ranAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}

    def keep(report, found):
        kept.write_text(json.dumps(kept_report(report, found, build), indent=2))
        print(f"\nreport kept: {kept}")

    deadline = time.time() + 420
    while time.time() < deadline:
        if ssh(f"test -f {LOGS}/{report_name} && echo yes").strip() == "yes":
            break
        time.sleep(3)
    else:
        put_prefs_back(stop_app=True)
        keep({"results": []}, ["no report after 7 minutes"])
        sys.exit("no report after 7 minutes")
    time.sleep(1)
    text = ssh(f"cat {LOGS}/{report_name}")
    try:
        report = json.loads(text)
    except json.JSONDecodeError as error:
        put_prefs_back()
        broken = kept.with_name(kept.stem + "-not-json.txt")
        broken.write_text(text)
        keep({"results": []}, [f"the report is not JSON ({error}), see {broken.name}"])
        sys.exit(f"the report is not JSON ({error}), kept as {broken}: {text[:200]!r}")
    found_late = []
    if args.smoke:
        shots = APP_DIR / "src-tauri/target/smoke" / args.host
        shots.mkdir(parents=True, exist_ok=True)
        for old in shots.glob("smoke-*.png"):
            old.unlink()
        copied = subprocess.run(["scp", "-4", "-q", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR",
                                 f"{HOSTS[args.host]}:Library/Logs/fi.cyborvent.htmllab/smoke-*.png", str(shots)])
        ssh(f"{shots_gone}; rm -f {prefs}/prefs.json; "
            f"test -f {prefs}/prefs.json.smoke-aside && mv {prefs}/prefs.json.smoke-aside {prefs}/prefs.json; true")
        print(f"pictures: {shots}")
        here = len(list(shots.glob("smoke-*.png")))
        made = sum(1 for r in report.get("results", []) if r.get("shot"))
        if copied.returncode or here < made:
            found_late.append(f"{here} of {made} pictures were copied back (scp exit {copied.returncode})")
    clip = ssh("pbpaste")
    ssh(f"rm -rf '{DEST}'")
    print(f"{args.host}: {str(report.get('ua'))[:60]}")
    print(f"total {report.get('total')}, passed {report.get('passed')}, failed {report.get('failed')}")
    if report.get("keyWindow") is False:
        print("the window was not the key window (a locked screen); focus checks used the page's own focus")
    if report.get("lostLoads"):
        print(f"page loads that stayed silent and were loaded again: {report['lostLoads']}")
        traces = APP_DIR / "src-tauri/target/lost-loads" / f"{args.host}.json"
        traces.parent.mkdir(parents=True, exist_ok=True)
        traces.write_text(json.dumps({k: report.get(k) for k in ("lostTraces", "rustTrace")}, indent=1))
        print(f"their traces: {traces}")
    for row in report.get("results") or []:
        if not row.get("ok"):
            print("FAIL", str(row.get("name"))[:80], "->", str(row.get("error"))[:400])
        elif args.smoke:
            print("ok  ", row["name"][:80], f'{row.get("ms")} ms', row.get("shot") or "no picture")
        elif args.only != "all" and not row["name"].startswith(("perf", "drag")):
            print("ok  ", row["name"][:160])
        elif row["name"].startswith(("perf", "drag")):
            extra = f" over20 {row['over']}% max {row['max']}" if "over" in row else ""
            print(row["name"], "median", row["ms"], "p95", row.get("p95"), extra)
    for error in report.get("errors") or []:
        print("ERROR", str(error).splitlines()[0][:300] if error else error)
    if report.get("lastCopied") is not None:
        print("clipboard matches the copied code:", clip == report["lastCopied"])
    found = problems(report, args.smoke, args.only, pinned_minimum(args.smoke), clip) + found_late
    keep(report, found)
    for line in found:
        print("NOT PASSED:", line)
    if not found:
        print("ALL PASS")
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
