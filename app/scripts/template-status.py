#!/usr/bin/env python3
import argparse
import hashlib
import json
import local_config
import pathlib
import subprocess
import sys

APP = pathlib.Path(__file__).resolve().parent.parent
TEMPLATES = APP / "core/content/templates"
GALLERY = APP / "core/content/gallery"
REVIEWS = APP / "scripts/template-reviews.json"
HISTORY = APP / "test-history"
INTEL = local_config.value("intel") if "--installed" in sys.argv else ""
NEEDED_RUNS = ("mini-selftest", "mini-smoke", "intel-selftest", "intel-smoke")
SKIP = {".DS_Store"}
BUILT_IN = {"my-picture.jpg", "stars.jpg", "saturn.jpg", "mars.jpg", "tree.jpg", "sun.jpg", "boat.jpg"}


def folder_hash(folder):
    digest = hashlib.sha256()
    for path in sorted(p for p in folder.rglob("*") if p.is_file() and p.name not in SKIP):
        digest.update(str(path.relative_to(folder)).encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def one_newline(text):
    return text.rstrip("\n").replace("\r", "") + "\n"


def git(*args):
    done = subprocess.run(["git", *args], cwd=APP, capture_output=True)
    return done.stdout if done.returncode == 0 else None


def packed_matches(folder, entry):
    if entry is None or not (GALLERY / "previews" / f"{folder.name}.webp").exists():
        return False
    on_disk = {p.name for p in folder.iterdir() if p.suffix in (".html", ".css", ".jpg", ".png", ".svg")}
    if {f["name"] for f in entry["files"]} != on_disk:
        return False
    for f in entry["files"]:
        if f.get("picture"):
            built_in = APP / "core/content/pictures" / f["name"]
            copy = built_in if f["name"] in BUILT_IN else GALLERY / "pictures" / f["name"]
            if not copy.exists() or copy.read_bytes() != (folder / f["name"]).read_bytes():
                return False
        elif f.get("code") != one_newline((folder / f["name"]).read_text(encoding="utf-8")):
            return False
    return True


def tested_builds():
    good = []
    for build in sorted(HISTORY.glob("*-*"), key=lambda p: p.stat().st_mtime, reverse=True):
        revision = build.name.split("-", 1)[1] if "-" in build.name else ""
        if not revision or revision == "unstamped" or revision.endswith("-dirty"):
            continue
        reports = [build / f"{run}.json" for run in NEEDED_RUNS]
        if not all(r.exists() for r in reports):
            continue
        loaded = [json.loads(r.read_text()) for r in reports]
        if all(r.get("total", 0) > 0 and r.get("failed", 1) == 0 for r in loaded):
            good.append((build.name, revision))
    return good


def build_carries(revision, prefix, tid, entry):
    raw = git("show", f"{revision}:{prefix}core/content/gallery/templates.json")
    if raw is None:
        return False
    old = next((t for t in json.loads(raw) if t.get("id") == tid), None)
    if old != entry:
        return False
    for f in entry["files"]:
        if f.get("picture"):
            where = "core/content/pictures" if f["name"] in BUILT_IN else "core/content/gallery/pictures"
            then = git("rev-parse", f"{revision}:{prefix}{where}/{f['name']}")
            now = git("hash-object", str(APP / where / f["name"]))
            if then is None or now is None or then.strip() != now.strip():
                return False
    return True


def installed_revision():
    done = subprocess.run(["ssh", "-4", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "LogLevel=ERROR", INTEL,
                           "/usr/libexec/PlistBuddy -c 'Print :HTMLLabRevision' '/Applications/HTML Lab.app/Contents/Info.plist'"],
                          capture_output=True, text=True)
    return done.stdout.strip() if done.returncode == 0 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--installed", action="store_true")
    ap.add_argument("--hash", metavar="FOLDER")
    args = ap.parse_args()
    if args.hash:
        print(folder_hash(TEMPLATES / args.hash))
        return 0

    folders = sorted(p for p in TEMPLATES.iterdir() if p.is_dir())
    if not folders:
        sys.exit(f"no template folders in {TEMPLATES}")
    reviews = json.loads(REVIEWS.read_text()) if REVIEWS.exists() else {}
    packed = {t["id"]: t for t in json.loads((GALLERY / "templates.json").read_text())}
    prefix = (git("rev-parse", "--show-prefix") or b"").decode().strip()
    builds = tested_builds()
    installed = installed_revision() if args.installed else None
    if args.installed and installed is None:
        print("the Intel Mac did not answer, or its copy has no revision stamp\n")

    rows, counts = [], dict.fromkeys(("written", "checked", "reviewed", "packed", "tested", "installed"), 0)
    for folder in folders:
        tid = f"template-{folder.name}"
        written = (folder / "template.json").exists()
        checked = written and subprocess.run([sys.executable, str(APP / "scripts/check-template.py"), str(folder)],
                                             capture_output=True).returncode == 0
        review = reviews.get(folder.name)
        if review is None:
            reviewed = "no"
        elif review.get("hash") == folder_hash(folder):
            reviewed = f"yes, {review.get('date', '?')}"
        else:
            reviewed = "changed since"
        is_packed = packed_matches(folder, packed.get(tid))
        tested = next((name for name, rev in builds if is_packed and build_carries(rev, prefix, tid, packed[tid])), None)
        carries_installed = bool(installed and is_packed and build_carries(installed, prefix, tid, packed[tid]))
        row = {
            "written": written, "checked": checked, "reviewed": reviewed.startswith("yes"),
            "packed": is_packed, "tested": tested is not None, "installed": carries_installed,
        }
        for key, ok in row.items():
            counts[key] += ok
        rows.append((folder.name, "yes" if written else "no", "pass" if checked else "FAIL" if written else "-",
                     reviewed, "yes" if is_packed else "no", tested or "no",
                     ("yes" if carries_installed else "no") if args.installed else "not asked"))

    print("| Template | Written | Checked | Reviewed | Packed | Tested build | Installed |")
    print("|----------|---------|---------|----------|--------|--------------|-----------|")
    for row in rows:
        print("| " + " | ".join(row) + " |")
    print()
    print(", ".join(f"{key} {value}" for key, value in counts.items()) + f" of {len(folders)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
