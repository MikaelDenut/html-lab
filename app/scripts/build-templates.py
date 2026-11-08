#!/usr/bin/env python3
import concurrent.futures
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

CATEGORIES = ["fun", "professional", "industrial", "creative", "science", "effects"]
BUILT_IN = {"my-picture.jpg", "stars.jpg", "saturn.jpg", "mars.jpg", "tree.jpg", "sun.jpg", "boat.jpg"}
PREVIEW = {"width": 800, "limit": 60 * 1024}
THUMB = {"width": 160, "limit": 8 * 1024}

APP = pathlib.Path(__file__).resolve().parent.parent
TEMPLATES = APP / "core/content/templates"
GALLERY = APP / "core/content/gallery"
RENDER_SRC = APP / "scripts/render-page.swift"
RENDER_BIN = APP / "src-tauri/target/tools/render-page"
SOURCES_HEADER = ("| File | Shows | Size (KB) | Pixels (WxH) | Author or agency | License | Commons file page |\n"
                  "|------|-------|-----------|--------------|------------------|---------|-------------------|")


def renderer():
    if not RENDER_BIN.exists() or RENDER_BIN.stat().st_mtime < RENDER_SRC.stat().st_mtime:
        RENDER_BIN.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["swiftc", "-O", str(RENDER_SRC), "-o", str(RENDER_BIN)], check=True)
    return RENDER_BIN


def page_order(folder, names):
    pages = sorted(n for n in names if n.endswith(".html"))
    pages.remove("index.html")
    home = (folder / "index.html").read_text(encoding="utf-8")
    first = {}
    for m in re.finditer(r'href="([\w-]+\.html)"', home):
        first.setdefault(m.group(1), m.start())
    pages.sort(key=lambda n: (first.get(n, len(home)), n))
    return ["index.html"] + pages


def one_newline(text):
    return text.rstrip("\n").replace("\r", "") + "\n"


def webp(png, out, width, limit):
    cwebp = shutil.which("cwebp")
    if not cwebp:
        sys.exit("cwebp is missing: install Homebrew webp")
    for quality in (80, 72, 64, 56, 48, 40):
        subprocess.run([cwebp, "-quiet", "-metadata", "none", "-q", str(quality), "-resize", str(width), "0",
                        str(png), "-o", str(out)], check=True, capture_output=True)
        if out.stat().st_size < limit:
            return
    sys.exit(f"{out}: still {out.stat().st_size} bytes at the lowest quality")


def draw(tid):
    with tempfile.TemporaryDirectory() as tmp:
        png = pathlib.Path(tmp) / "preview.png"
        for _ in range(2):
            out = subprocess.run([str(renderer()), str(TEMPLATES / tid / "index.html"), str(png), "1280", "800"],
                                 capture_output=True, text=True)
            if png.exists():
                break
        lines = out.stdout.strip().splitlines()
        try:
            report = json.loads(lines[-1]) if lines else {}
        except ValueError:
            report = {}
        if out.returncode or not png.exists() or "missing" not in report or "overflowX" not in report \
                or report.get("missing") or report.get("overflowX"):
            return f"{tid}: preview render failed: {out.stdout} {out.stderr}"
        webp(png, GALLERY / "previews" / f"{tid}.webp", **PREVIEW)
        webp(png, GALLERY / "thumbs" / f"{tid}.webp", **THUMB)
    return None


def leave_old_places():
    rs = APP / "core/src/template_pictures.rs"
    if rs.exists():
        for name in re.findall(r'\("([^"]+)", include_bytes', rs.read_text(encoding="utf-8")):
            if name not in BUILT_IN:
                (APP / "core/content/pictures" / name).unlink(missing_ok=True)
        rs.unlink()
    (APP / "core/content/templates.json").unlink(missing_ok=True)
    shutil.rmtree(APP / "ui/templates", ignore_errors=True)
    sources = APP / "core/content/pictures/SOURCES.md"
    start = "<!-- template pictures: written by scripts/build-templates.py -->"
    text = sources.read_text(encoding="utf-8")
    if start in text:
        sources.write_text(text[:text.index(start)].rstrip() + "\n", encoding="utf-8")


def main():
    draft = "--draft" in sys.argv[1:]
    only = next((a.split("=", 1)[1].split(",") for a in sys.argv[1:] if a.startswith("--only=")), None)
    leave_old_places()
    for sub in ("pictures", "previews", "thumbs"):
        (GALLERY / sub).mkdir(parents=True, exist_ok=True)

    folders = sorted(p for p in TEMPLATES.iterdir() if p.is_dir() and not p.name.startswith("."))
    every = [f.name for f in folders]
    if only:
        unknown = sorted(set(only) - set(every))
        if unknown:
            sys.exit(f"--only: no template folder named {', '.join(unknown)}")
        folders = [f for f in folders if f.name in only]
    no_meta = [f.name for f in folders if not (f / "template.json").is_file()]
    if no_meta and not draft:
        sys.exit(f"no template.json in: {', '.join(no_meta)}")
    metas = {}
    for folder in folders:
        if folder.name not in no_meta:
            metas[folder.name] = json.loads((folder / "template.json").read_text(encoding="utf-8"))
    if not metas:
        sys.exit(f"no templates to pack in {TEMPLATES}")
    for tid, meta in metas.items():
        if meta.get("category") not in CATEGORIES:
            sys.exit(f"{tid}: category {meta.get('category')!r} is not one of {CATEGORIES}")
    present = sorted(metas, key=lambda t: (CATEGORIES.index(metas[t]["category"]), metas[t]["title"].lower()))

    failed = []
    for tid in present:
        check = subprocess.run([sys.executable, str(APP / "scripts/check-template.py"), str(TEMPLATES / tid)],
                               capture_output=True, text=True)
        verdict = check.stdout.strip().splitlines()
        if check.returncode or not verdict or not verdict[-1].startswith(f"PASS: {tid},"):
            failed.append(tid)
            print(check.stdout.strip() or f"{tid}: the checker printed no verdict")
            if check.stderr.strip():
                print(check.stderr.strip())
    if failed and not draft:
        sys.exit(f"fix these first: {', '.join(failed)}")

    packed, pictures, source_rows = [], [], []
    for tid in present:
        folder, meta = TEMPLATES / tid, metas[tid]
        names = {p.name for p in folder.iterdir() if p.is_file()}
        files = []
        for name in page_order(folder, names):
            files.append({"name": name, "code": one_newline((folder / name).read_text(encoding="utf-8")),
                          "hidden": False})
        files.insert(1, {"name": "style.css", "code": one_newline((folder / "style.css").read_text(encoding="utf-8")),
                         "hidden": False})
        for name in sorted(n for n in names if n.endswith((".jpg", ".png"))):
            files.append({"name": name, "hidden": True, "picture": True})
            if name not in BUILT_IN:
                shutil.copyfile(folder / name, GALLERY / "pictures" / name)
                pictures.append(name)
        for name in sorted(n for n in names if n.endswith(".svg")):
            files.append({"name": name, "code": one_newline((folder / name).read_text(encoding="utf-8")), "hidden": True})
        rows_file = folder / "SOURCES-rows.md"
        if rows_file.exists():
            for line in rows_file.read_text(encoding="utf-8").splitlines():
                if line.startswith("|") and not re.match(r"^\|\s*(File|-)", line):
                    source_rows.append(line)
        packed.append({
            "id": f"template-{tid}",
            "title": meta["title"],
            "name": meta["name"],
            "style": "file",
            "blurb": meta["blurb"],
            "group": "template",
            "shows": meta["shows"],
            "accent": meta["accent"],
            "category": meta["category"],
            "layout": meta["layout"],
            "needs": meta.get("needs", []),
            "files": files,
        })

    renderer()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        errors = [e for e in pool.map(draw, present) if e]
    if errors:
        sys.exit("\n".join(errors))

    (GALLERY / "templates.json").write_text(json.dumps(packed, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (GALLERY / "SOURCES.md").write_text(
        "# Template gallery pictures\n\nWritten by scripts/build-templates.py from each template's SOURCES-rows.md. "
        "Every photo is public domain or CC0.\n\n" + SOURCES_HEADER + "\n" + "\n".join(source_rows) + "\n",
        encoding="utf-8")

    for old in (GALLERY / "pictures").iterdir():
        if old.name not in pictures:
            old.unlink()
    for sub in ("previews", "thumbs"):
        for old in (GALLERY / sub).iterdir():
            if old.stem not in present or old.suffix != ".webp":
                old.unlink()

    def kb(paths):
        return sum(p.stat().st_size for p in paths) // 1024
    print(f"packed {len(packed)} of {len(every)} template folders: pictures {len(pictures)} "
          f"({kb((GALLERY / 'pictures').iterdir())} KB), "
          f"previews {kb((GALLERY / 'previews').glob('*.webp'))} KB, thumbs {kb((GALLERY / 'thumbs').glob('*.webp'))} KB, "
          f"templates.json {(GALLERY / 'templates.json').stat().st_size // 1024} KB")
    if len(packed) < len(every):
        print(f"PARTIAL: the gallery misses {', '.join(sorted(set(every) - set(present)))}")
    if no_meta:
        print(f"DRAFT: not packed, no template.json: {', '.join(no_meta)}")
    if failed:
        print(f"DRAFT: packed with checker failures: {', '.join(failed)}")


main()
