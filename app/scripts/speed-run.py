#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import local_config
import plistlib
import re
import subprocess
import sys
import time

HOST = local_config.value("intel")
SSH = ["ssh", "-4", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "LogLevel=ERROR", HOST]
LOGS = "~/Library/Logs/fi.cyborvent.htmllab"
DEST = "/tmp/HTML Lab Test.app"
HERE = pathlib.Path(__file__).resolve().parent


# The import statements esbuild writes at the top of a module: import"x", import{a}from"x",
# import*as a from"x", export{a}from"x", export*from"x". A dynamic import("x") is not one.
TOP_IMPORT = re.compile(
    r"""\s*(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?(["'])([^"']+)\1\s*;?"""
)


def static_closure(entry):
    """The entry plus every chunk it imports statically, recursively: what loads at start."""
    seen, todo = [], [entry.resolve()]
    while todo:
        path = todo.pop()
        if path in seen:
            continue
        seen.append(path)
        text, at = path.read_text(encoding="utf-8"), 0
        while (found := TOP_IMPORT.match(text, at)) and found.end() > at:
            at = found.end()
            target = found.group(2)
            if target.startswith("."):
                todo.append((path.parent / target).resolve())
    return seen


def editor_files(ui):
    """The editor bundle and every chunk in ui/editor/, loaded at start or not."""
    return [ui / "editor.bundle.js"] + sorted((ui / "editor").glob("*.js"))


def ssh(command, check=True):
    done = subprocess.run(SSH + [command], capture_output=True, text=True)
    if check and done.returncode:
        sys.exit(f"ssh failed: {command}\n{done.stderr}")
    return done.stdout


def web_pids():
    return {int(p) for p in ssh("pgrep -f com.apple.WebKit || true").split()}


def snapshot(pids):
    if not pids:
        return {}
    out = ssh("ps -o pid=,rss=,time= -p " + ",".join(str(p) for p in sorted(pids)), check=False)
    rows = {}
    for line in out.splitlines():
        pid, rss, used = line.split()
        minutes, seconds = used.split(":")
        rows[int(pid)] = (int(rss), int(minutes) * 60 + float(seconds))
    return rows


def run_once(extra_note, measure):
    ssh(f"rm -f {LOGS}/speed-latest.json")
    before = web_pids()
    stamp = "$(perl -MTime::HiRes -e 'print int(Time::HiRes::time()*1000)')"
    ssh(f"open -n '{DEST}' --args --speed-check --speed-start={stamp}")
    deadline = time.time() + 240
    while time.time() < deadline:
        if ssh(f"test -f {LOGS}/speed-latest.json && echo yes || true").strip() == "yes":
            break
        time.sleep(1)
    else:
        sys.exit(f"{extra_note}: no report after 4 minutes")
    numbers = {}
    if measure:
        time.sleep(4)
        pid = ssh("pgrep -x html-lab || true").split()
        ours = {int(p) for p in pid} | (web_pids() - before)
        first = snapshot(ours)
        began = time.time()
        time.sleep(18)
        second = snapshot(ours)
        spent = sum(second[p][1] - first[p][1] for p in second if p in first)
        numbers["idle_cpu"] = round(100 * spent / (time.time() - began), 2)
        numbers["memory_mb"] = round(sum(v[0] for v in second.values()) / 1024, 1)
        numbers["processes"] = len(second)
        names = ssh("ps -o pid=,comm= -p " + ",".join(str(p) for p in sorted(second)), check=False)
        for line in names.splitlines():
            pid, comm = line.split(None, 1)
            pid = int(pid)
            if pid in first:
                used = second[pid][1] - first[pid][1]
                print(f"  idle {comm.rsplit('/', 1)[-1]}: {used:.2f} s CPU, {second[pid][0] // 1024} MB")
    deadline = time.time() + 60
    while time.time() < deadline and ssh("pgrep -x html-lab || true").strip():
        time.sleep(1)
    return ssh(f"cat {LOGS}/speed-latest.json"), numbers


STATS = ("median", "p95", "max", "percentOver20")


def build_of(app):
    info = plistlib.loads((pathlib.Path(app) / "Contents/Info.plist").read_bytes())
    return info.get("CFBundleShortVersionString", "unknown"), info.get("HTMLLabRevision", "unstamped")


def middle(values):
    values = sorted(v for v in values if v is not None)
    return values[len(values) // 2] if values else None


def combine(reports):
    rows, spread = {}, {}
    keys = {k for r in reports for k in r.get("rows", {})}
    for key in sorted(keys):
        per_run = [r.get("rows", {}).get(key) for r in reports]
        if all(isinstance(v, dict) for v in per_run):
            rows[key] = {s: middle([v.get(s) for v in per_run]) for s in STATS if any(s in v for v in per_run)}
            spread[key] = {s: [v.get(s) for v in per_run] for s in rows[key]}
        else:
            rows[key] = middle(per_run) if all(isinstance(v, (int, float)) for v in per_run) else None
            spread[key] = per_run
    errors = [f"run {i + 1}: {e}" for i, r in enumerate(reports) for e in r.get("errors", [])]
    return {"rows": rows, "spread": spread, "errors": errors}


def same_build(stem, name):
    return stem == name or (stem.startswith(name + "-") and stem[len(name) + 1:].isdigit())


def keep(history, name, combined, lines):
    """Write the record under a name not yet taken, so a second run for one build adds -2 and keeps the first."""
    stem, n = name, 1
    while (history / f"{stem}.json").exists() or (history / f"{stem}.txt").exists():
        n += 1
        stem = f"{name}-{n}"
    (history / f"{stem}.json").write_text(json.dumps(combined, indent=2))
    (history / f"{stem}.txt").write_text("\n".join(lines) + "\n")
    return stem


def compare(now, history, name):
    earlier = sorted((p for p in history.glob("*.json") if not same_build(p.stem, name)), key=lambda p: p.stat().st_mtime)
    if not earlier:
        return ["no earlier build in the history to compare with"]
    before = json.loads(earlier[-1].read_text())
    lines = [f"against {earlier[-1].stem}:"]
    for key, row in now["rows"].items():
        old = before.get("rows", {}).get(key)
        if isinstance(row, dict) and isinstance(old, dict):
            stat = "p95" if "p95" in row else next(iter(row), None)
            if stat and row.get(stat) is not None and old.get(stat) is not None:
                lines.append(f"  {key} {stat}: {old[stat]} -> {row[stat]} ({row[stat] - old[stat]:+.1f})")
        elif isinstance(row, (int, float)) and isinstance(old, (int, float)):
            lines.append(f"  {key}: {old} -> {row} ({row - old:+.1f})")
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("app")
    ap.add_argument("--runs", type=int, default=3, help="measured runs with no last tabs (default 3)")
    ap.add_argument("--out", help="default src-tauri/target/speed/<version>-<revision>")
    args = ap.parse_args()
    version, revision = build_of(args.app)
    name = f"{version}-{revision}"
    print(f"HTML Lab {version} at {revision}" + ("  (UNSTAMPED: no revision in this build)" if revision == "unstamped" else ""))
    out = pathlib.Path(args.out or HERE.parent / "src-tauri/target/speed" / name)
    out.mkdir(parents=True, exist_ok=True)

    ssh(f"rm -rf '{DEST}'; true")
    parent, bundle = os.path.split(args.app.rstrip("/"))
    pack = subprocess.Popen(["tar", "-C", parent, "-cf", "-", "-s", f",^{bundle},HTML Lab Test.app,", bundle], stdout=subprocess.PIPE)
    subprocess.run(SSH + ["tar -C /tmp -xf -"], stdin=pack.stdout, check=True)
    pack.wait()
    ssh(f"xattr -cr '{DEST}'")
    prefs = "~/Library/Application\\ Support/fi.cyborvent.htmllab"

    print("warm run, not measured")
    run_once("warm", False)
    reports, numbers = [], []
    for i in range(args.runs):
        ssh(f"rm -rf {prefs}")
        print(f"measured run {i + 1} of {args.runs}, no last tabs")
        text, measured = run_once(f"run {i + 1}", True)
        (out / f"run-{i + 1}.json").write_text(text)
        reports.append(json.loads(text))
        numbers.append(measured)
        print("  measured:", json.dumps(measured))
    print("last run, three tabs reopen")
    second, _ = run_once("reopen", False)
    (out / "reopen.json").write_text(second)

    combined = combine(reports)
    combined.update(version=version, revision=revision, runs=args.runs,
                    idle_cpu=middle([n["idle_cpu"] for n in numbers]),
                    memory_mb=middle([n["memory_mb"] for n in numbers]),
                    idle_spread={"idle_cpu": [n["idle_cpu"] for n in numbers], "memory_mb": [n["memory_mb"] for n in numbers]})
    (out / "combined.json").write_text(json.dumps(combined, indent=2))

    size = subprocess.run(["du", "-sk", args.app], capture_output=True, text=True).stdout.split()[0]
    editor = sum(f.stat().st_size for f in static_closure(HERE.parent / "ui/editor.bundle.js")) / 1024
    editor_all = sum(f.stat().st_size for f in editor_files(HERE.parent / "ui")) / 1024
    ssh(f"rm -rf '{DEST}'; true")
    gate = [
        sys.executable, str(HERE / "speed-gate.py"), str(out / "combined.json"),
        "--second-run", str(out / "reopen.json"),
        "--idle-cpu", str(combined["idle_cpu"]), "--memory-mb", str(combined["memory_mb"]),
        "--editor-kb", str(round(editor, 1)), "--editor-all-kb", str(round(editor_all, 1)),
        "--app-mb", str(round(int(size) / 1024, 1)),
    ]
    done = subprocess.run(gate, capture_output=True, text=True)
    lines = [f"HTML Lab {version} at {revision}, Intel test Mac, {args.runs} measured runs, medians",
             time.strftime("%Y-%m-%d %H:%M"), ""] + done.stdout.splitlines()

    history = HERE.parent / "speed-history"
    history.mkdir(exist_ok=True)
    lines += [""] + compare(combined, history, name)
    print("\n".join(lines))
    if revision != "unstamped" and not revision.endswith("-dirty"):
        print(f"\nkept in speed-history as {keep(history, name, combined, lines)}")
    else:
        print(f"\nnot kept in speed-history: {revision} is not a committed build")
    sys.exit(done.returncode)


if __name__ == "__main__":
    main()
