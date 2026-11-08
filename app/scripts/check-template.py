#!/usr/bin/env python3
import html.parser
import pathlib
import re
import sys

FONTS = {
    "american typewriter", "andale mono", "apple chancery", "arial", "arial black",
    "arial narrow", "arial rounded mt bold", "athelas", "avenir", "avenir next",
    "avenir next condensed", "baskerville", "big caslon", "bodoni 72", "bradley hand",
    "brush script mt", "chalkboard", "chalkboard se", "chalkduster", "charter", "cochin",
    "comic sans ms", "copperplate", "courier", "courier new", "din alternate",
    "din condensed", "didot", "futura", "geneva", "georgia", "gill sans", "helvetica",
    "helvetica neue", "herculanum", "hoefler text", "impact", "iowan old style",
    "lucida grande", "luminari", "marker felt", "menlo", "monaco", "noteworthy", "optima",
    "palatino", "papyrus", "party let", "phosphate", "pt mono", "pt sans", "pt serif",
    "rockwell", "savoye let", "seravek", "signpainter", "skia", "snell roundhand",
    "superclarendon", "tahoma", "times", "times new roman", "trattatello", "trebuchet ms",
    "verdana", "zapfino",
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "-apple-system",
    "inherit", "initial",
}

CSS_FORBIDDEN = {
    "color-mix(": "color-mix() does not work on the oldest supported Mac",
    "@container": "container queries do not work on the oldest supported Mac",
    "container-type": "container queries do not work on the oldest supported Mac",
    "subgrid": "subgrid does not work on the oldest supported Mac",
    "text-wrap": "text-wrap does not work on the oldest supported Mac",
    "@property": "@property is newer than the oldest supported Mac",
    "@layer": "keep @layer out, it is hard to read at his age",
    "@import": "no @import, link each file from the page",
    "@font-face": "no font files, use the Mac's own fonts",
    "url(http": "no pictures from the internet, use a local file",
    "light-dark(": "light-dark() is newer than the oldest supported Mac",
    "anchor-name": "anchor positioning is newer than the oldest supported Mac",
    "view-transition": "view transitions are newer than the oldest supported Mac",
    "@starting-style": "@starting-style is newer than the oldest supported Mac",
    "round(": "round() is newer than the oldest supported Mac",
}

MAX_PAGE = 14_000
MAX_CSS = 20_000
MAX_PICTURE = 102_400
MAX_PICTURES_TOTAL = 409_600
MAX_PHOTOS = 6
CATEGORIES = {"fun", "professional", "industrial", "creative", "science", "effects"}
BUILT_IN = {"my-picture.jpg", "stars.jpg", "saturn.jpg", "mars.jpg", "tree.jpg", "sun.jpg", "boat.jpg"}
NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*\.(html|css|jpg|png|svg)$")

problems = []


def bad(where, text):
    problems.append(f"{where}: {text}")


class Page(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.ids = set()
        self.links = []
        self.sources = []
        self.imgs_without_alt = 0
        self.stylesheets = []
        self.title = False
        self.charset = False
        self.viewport = False
        self.lang = None
        self.h1 = 0
        self.label_depth = 0
        self.label_for = set()
        self.inputs = []
        self.current = []
        self.form_depth = 0
        self.forms = 0
        self.sends = False
        self.style_attrs = []
        self.style_tags = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.tags.append(tag)
        if "id" in a:
            self.ids.add(a["id"])
        for key in a:
            if key.startswith("on"):
                bad(self.where, f"<{tag} {key}=...>: no script in the app")
        if tag == "a" and "href" in a:
            self.links.append(a["href"])
            if a.get("aria-current") == "page":
                self.current.append(a["href"])
        if tag == "form":
            self.form_depth += 1
            self.forms += 1
        if tag == "button" and not self.form_depth:
            bad(self.where, "a <button> outside a form does nothing without a script: use a link, or put it in a form")
        if self.form_depth and (tag in ("textarea", "select")
                                or (tag == "input" and a.get("type", "text") not in ("checkbox", "radio", "reset", "hidden"))
                                or (tag == "button" and a.get("type", "submit") == "submit")):
            self.sends = True
        if tag == "img":
            self.sources.append(a.get("src", ""))
            if not a.get("alt") and a.get("alt") != "":
                self.imgs_without_alt += 1
            if "width" not in a or "height" not in a:
                bad(self.where, f"<img src=\"{a.get('src', '')}\"> needs width and height, so the page does not jump")
        if tag == "html":
            self.lang = a.get("lang")
        if tag == "meta" and a.get("name") == "viewport":
            self.viewport = "width=device-width" in a.get("content", "")
        if tag == "h1":
            self.h1 += 1
        if tag == "label":
            self.label_depth += 1
            if "for" in a:
                self.label_for.add(a["for"])
        if tag in ("input", "select", "textarea") and a.get("type") not in ("hidden", "submit", "button", "reset"):
            self.inputs.append((a.get("id"), self.label_depth > 0))
        if tag == "form" and ("action" in a or "method" in a):
            bad(self.where, "<form> with action or method: HTML Lab does not send forms, leave both out")
        if tag == "link" and a.get("rel") == "stylesheet":
            self.stylesheets.append(a.get("href", ""))
        if tag == "meta" and a.get("charset", "").lower() == "utf-8":
            self.charset = True
        if tag == "title":
            self.title = True
        if tag in ("script", "iframe", "video", "audio", "object", "embed"):
            bad(self.where, f"<{tag}>: not in templates (no script, no media)")
        if "style" in a and len(a["style"]) > 80:
            bad(self.where, f"<{tag}> has a long style attribute: move it to style.css")
        if a.get("style"):
            self.style_attrs.append(a["style"])
        if tag == "style":
            self.style_tags += 1

    def handle_endtag(self, tag):
        if tag == "label" and self.label_depth:
            self.label_depth -= 1
        if tag == "form" and self.form_depth:
            self.form_depth -= 1


def check_text(where, text):
    if "—" in text or "–" in text:
        bad(where, "em or en dash: use a plain hyphen")
    if "\t" in text:
        bad(where, "tab character: indent with 2 spaces")
    for n, line in enumerate(text.splitlines(), 1):
        if line != line.rstrip():
            bad(where, f"line {n}: space at the end")
            break


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


GENERIC = {"serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "-apple-system"}
FONT_SIZE = re.compile(r"^(?:[\d.]+(?:px|em|rem|%|pt|pc|vw|vh|vmin|vmax|ex|ch|cm|mm|in|q)|xx-small|x-small|small|"
                       r"medium|large|x-large|xx-large|smaller|larger|(?:calc|clamp|min|max|var)\(.*\))(?:/.+)?$")
WEBKIT_PAIRS = [
    (r"(?<![-\w])clip-path\s*:", r"-webkit-clip-path\s*:", "clip-path needs a -webkit-clip-path copy on the oldest supported Mac"),
    (r"(?<![-\w])backdrop-filter\s*:", r"-webkit-backdrop-filter\s*:",
     "backdrop-filter needs -webkit-backdrop-filter too on the oldest supported Mac"),
    (r"(?<![-\w])background-clip\s*:\s*text", r"-webkit-background-clip\s*:\s*text",
     "background-clip: text needs -webkit-background-clip: text on the oldest supported Mac"),
]


def split_top(text, sep):
    parts, cur, depth, quote = [], "", 0, ""
    for ch in text:
        if quote:
            quote = "" if ch == quote else quote
        elif ch in "\"'":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif not depth and (ch == sep or (sep == " " and ch.isspace())):
            parts.append(cur)
            cur = ""
            continue
        cur += ch
    parts.append(cur)
    return [p for p in parts if p.strip()] if sep == " " else parts


def check_pairs(where, blocks):
    for plain_re, webkit_re, why in WEBKIT_PAIRS:
        if any(re.search(plain_re, b) and not re.search(webkit_re, b) for b in blocks):
            if f"{where}: {why}" not in problems:
                bad(where, why)


def check_families(where, families, place=""):
    for family in families:
        name = family.strip().strip("'\"").lower()
        if name.startswith("var("):
            continue
        if name and name not in FONTS:
            bad(where, f"font '{family.strip()}'{place} is not on the oldest supported Mac")


def check_fonts(where, plain):
    for stack_text in re.findall(r"font-family\s*:\s*([^;}]+)", plain, flags=re.I):
        check_families(where, stack_text.split(","))
    for value in re.findall(r"(?<![-\w])font\s*:\s*([^;}]+)", plain, flags=re.I):
        groups = split_top(value, ",")
        words = split_top(re.sub(r"\s*/\s*", "/", groups[0]), " ")
        at = next((i for i, w in enumerate(words[:-1]) if FONT_SIZE.match(w.lower())), None)
        if at is not None:
            check_families(where, [" ".join(words[at + 1:])] + groups[1:])
    for value in re.findall(r"--[\w-]+\s*:\s*([^;}]+)", plain):
        families = value.split(",")
        stack = len(families) > 1 and families[-1].strip().strip("'\"").lower() in GENERIC
        for family in families:
            name = family.strip().strip("'\"").lower()
            if stack and name and not name.startswith("var(") and name not in FONTS:
                bad(where, f"font '{family.strip()}' in a variable is not on the oldest supported Mac")
            elif not stack and re.match(r"^[a-z][a-z ]+$", name) and " " in name and name not in FONTS:
                bad(where, f"font '{family.strip()}' in a variable is not on the oldest supported Mac")


def check_style_attribute(where, value):
    low = value.lower()
    for token, why in CSS_FORBIDDEN.items():
        if token in low:
            bad(where, f"style attribute: {why}")
    check_pairs(where, [low])
    check_fonts(where, value)


def check_css(where, css):
    plain = strip_comments(css)
    low = plain.lower()
    for token, why in CSS_FORBIDDEN.items():
        if token in low:
            bad(where, why)
    if "backdrop-filter" in low and "-webkit-backdrop-filter" not in low:
        bad(where, "backdrop-filter needs -webkit-backdrop-filter too on the oldest supported Mac")
    for line in re.findall(r"[^;{}]*clip-path\s*:[^;{}]*", low):
        if "-webkit-clip-path" not in low:
            bad(where, "clip-path needs a -webkit-clip-path copy on the oldest supported Mac")
            break
    if re.search(r"(?<!-webkit-)background-clip\s*:\s*text", low) and "-webkit-background-clip: text" not in low:
        bad(where, "background-clip: text needs -webkit-background-clip: text on the oldest supported Mac")
    check_pairs(where, re.findall(r"\{([^{}]*)\}", low))
    if re.search(r"outline\s*:\s*(none|0)\b", low) and ":focus-visible" not in low:
        bad(where, "outline: none hides where the keyboard is: add a :focus-visible style")
    depth = 0
    stack = []
    stray = 0
    i = 0
    head = ""
    while i < len(plain):
        ch = plain[i]
        if ch == "{":
            prelude = head.strip()
            if stack and stack[-1] == "rule":
                bad(where, f"nested rule near '{prelude[:40]}': CSS nesting does not work on the oldest supported Mac")
            stack.append("group" if prelude.startswith(("@media", "@supports")) else
                         "keyframes" if prelude.startswith("@keyframes") else
                         "frame" if stack and stack[-1] == "keyframes" else "rule")
            head = ""
        elif ch == "}":
            if stack:
                stack.pop()
            else:
                stray += 1
            head = ""
        elif ch == ";":
            head = ""
        else:
            head += ch
        i += 1
    if stack:
        bad(where, "a { without its }")
    if stray:
        bad(where, "a } without its {")
    if re.search(r"(^|[\s,{])&", plain):
        bad(where, "& is CSS nesting, which does not work on the oldest supported Mac")
    check_fonts(where, plain)
    comments = len(re.findall(r"/\*", css))
    if comments < 6:
        bad(where, f"only {comments} comments: explain each trick in a child's words")


def main():
    folder = pathlib.Path(sys.argv[1])
    tid = folder.name
    files = sorted(p for p in folder.iterdir() if p.is_file() and not p.name.startswith("."))
    names = {p.name for p in files}
    extra = {"SOURCES-rows.md", "template.json"}
    import json
    meta_path = folder / "template.json"
    if not meta_path.exists():
        bad(tid, "no template.json (title, name, blurb, category, layout, shows, accent)")
    else:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        for key in ("title", "name", "blurb", "category", "layout", "shows", "accent"):
            if key not in meta:
                bad("template.json", f"no '{key}'")
            elif key != "shows" and not (isinstance(meta[key], str) and meta[key].strip()):
                bad("template.json", f"'{key}' is empty or not text")
        words = {k: v for k, v in meta.items() if isinstance(v, str)}
        if meta.get("category") not in CATEGORIES:
            bad("template.json", f"category must be one of {', '.join(sorted(CATEGORIES))}")
        if not (0 < len(words.get("layout", "")) <= 60):
            bad("template.json", "layout: a few words, under 60 characters")
        if len(words.get("blurb", "")) > 70:
            bad("template.json", "blurb over 70 characters")
        shows = meta.get("shows", [])
        if not isinstance(shows, list) or not all(isinstance(x, str) and x.strip() for x in shows):
            bad("template.json", "shows: a list of lines of text")
            shows = [str(x) for x in shows] if isinstance(shows, list) else []
        if not (3 <= len(shows) <= 5) or any(len(x) >= 48 for x in shows):
            bad("template.json", "shows: 3 to 5 items, each under 48 characters")
        needs = meta.get("needs", [])
        if not isinstance(needs, list) or not all(
                isinstance(x, str) and re.fullmatch(r"(selector)?\(.+\)", x.strip()) for x in needs):
            bad("template.json", "needs: a list of CSS.supports conditions like \"selector(:has(a))\"")
        check_text("template.json", meta_path.read_text(encoding="utf-8"))
    for p in files:
        if p.name in extra:
            continue
        if not NAME.match(p.name):
            bad(p.name, "file name: small letters, digits and hyphens only")
        if p.suffix == ".css" and p.name != "style.css":
            bad(p.name, "only style.css holds CSS: this file is never checked or packed")
    if "index.html" not in names:
        bad(tid, "no index.html")
    if "style.css" not in names:
        bad(tid, "no style.css")
    pages = [p for p in files if p.suffix == ".html"]
    if len(pages) < 3:
        bad(tid, f"{len(pages)} pages: a template has 3 pages linked by a menu")
    outside = 0
    used_pictures = set()
    for p in pages:
        text = p.read_text(encoding="utf-8")
        check_text(p.name, text)
        if len(text) > MAX_PAGE:
            bad(p.name, f"{len(text)} bytes: keep a page under {MAX_PAGE}")
        if not text.startswith("<!doctype html>\n"):
            bad(p.name, "must start with <!doctype html> on its own line")
        parser = Page()
        parser.where = p.name
        parser.feed(text)
        if not parser.charset:
            bad(p.name, 'no <meta charset="utf-8">')
        if not parser.title:
            bad(p.name, "no <title>")
        if parser.lang != "en":
            bad(p.name, 'needs <html lang="en">')
        if not parser.viewport:
            bad(p.name, 'needs <meta name="viewport" content="width=device-width, initial-scale=1">')
        if parser.h1 != 1:
            bad(p.name, f"{parser.h1} h1 headings: a page has exactly one")
        for input_id, wrapped in parser.inputs:
            if not wrapped and (not input_id or input_id not in parser.label_for):
                bad(p.name, f"an input{' #' + input_id if input_id else ''} has no label")
        if parser.stylesheets != ["style.css"]:
            bad(p.name, f"stylesheets {parser.stylesheets}: link style.css, once")
        if parser.imgs_without_alt:
            bad(p.name, f"{parser.imgs_without_alt} pictures without alt text")
        for href in parser.links:
            if href.startswith("https://"):
                outside += 1
            elif href.startswith("http://"):
                bad(p.name, f"{href}: use https://")
            elif href == "#":
                bad(p.name, 'href="#" goes nowhere: link to a page or to a place with an id')
            elif href.startswith("#"):
                if href[1:] not in parser.ids and href != "#top":
                    bad(p.name, f"{href}: no element with that id on this page")
            elif href.startswith(("mailto:", "tel:")):
                bad(p.name, f"{href}: no mail or phone links")
            else:
                target = href.split("#")[0]
                if target not in names:
                    bad(p.name, f"link to {href}: no such file in the template")
        for src in parser.sources:
            if src.startswith(("http", "//", "data:")):
                bad(p.name, f"picture {src[:40]}: use a local file")
            elif src not in names:
                bad(p.name, f"picture {src}: no such file in the template")
            else:
                used_pictures.add(src)
        for ref in re.findall(r'url\(["\']?([^)"\']+)', text):
            if not ref.startswith("#") and ref not in names:
                bad(p.name, f"url({ref}): no such file")
            used_pictures.add(ref)
        if "<style" in text or parser.style_tags:
            bad(p.name, "no <style> block: all CSS goes in style.css")
        for value in parser.style_attrs:
            check_style_attribute(p.name, value)
        reached = {h.split("#")[0] for h in parser.links if h.split("#")[0].endswith(".html")}
        for other in pages:
            if other.name not in reached:
                bad(p.name, f"no link to {other.name}: the menu on every page reaches every page")
        if p.name not in parser.current:
            bad(p.name, f'its menu link to {p.name} needs aria-current="page"')
        if parser.sends and "HTML Lab does not send it" not in text:
            bad(p.name, 'a form needs the line "A practice form: HTML Lab does not send it."')
    if outside < 1:
        bad(tid, "no outside link (https://...): one is part of the lesson")
    css_path = folder / "style.css"
    if css_path.exists():
        css = css_path.read_text(encoding="utf-8")
        check_text("style.css", css)
        if len(css) > MAX_CSS:
            bad("style.css", f"{len(css)} bytes: keep it under {MAX_CSS}")
        check_css("style.css", css)
        for ref in re.findall(r'url\(["\']?([^)"\']+)', strip_comments(css)):
            if ref.startswith("data:"):
                continue
            if ref not in names:
                bad("style.css", f"url({ref}): no such file in the template")
            used_pictures.add(ref)
    for p in files:
        if p.suffix in (".jpg", ".png", ".svg"):
            if not p.name.startswith(tid + "-") and p.name not in BUILT_IN:
                bad(p.name, f"picture names start with '{tid}-'")
            if p.stat().st_size > MAX_PICTURE:
                bad(p.name, f"{p.stat().st_size // 1024} KB: keep a picture under {MAX_PICTURE // 1024} KB")
            data = p.read_bytes()
            if not {".jpg": data.startswith(b"\xff\xd8\xff"), ".png": data.startswith(b"\x89PNG\r\n\x1a\n"),
                    ".svg": b"<svg" in data}[p.suffix]:
                bad(p.name, f"not a real {p.suffix[1:]} picture: empty, or a file of another kind")
            if p.name not in used_pictures:
                bad(p.name, "picture not used by any page")
        if p.suffix == ".svg":
            svg = p.read_text(encoding="utf-8")
            check_text(p.name, svg)
            if re.search(r"<script|<[^>]*\son[a-z]+\s*=", svg, flags=re.I):
                bad(p.name, "<script> or on...= in a drawing: no script in the app")
    pictures = [p for p in files if p.suffix in (".jpg", ".png")]
    own = [p for p in pictures if p.name not in BUILT_IN]
    if len(own) > MAX_PHOTOS:
        bad(tid, f"{len(own)} photos: at most {MAX_PHOTOS}, draw the rest with CSS or SVG")
    total = sum(p.stat().st_size for p in own)
    if total > MAX_PICTURES_TOTAL:
        bad(tid, f"photos together {total // 1024} KB: keep them under {MAX_PICTURES_TOTAL // 1024} KB")
    if own:
        sources = folder / "SOURCES-rows.md"
        listed = sources.read_text(encoding="utf-8") if sources.exists() else ""
        for p in own:
            row = next((line for line in listed.splitlines() if line.startswith(f"| {p.name} |")), "")
            cells = [c.strip() for c in row.strip().strip("|").split("|")]
            if not row:
                bad(p.name, "no row in SOURCES-rows.md (author, license, Commons page)")
            elif len(cells) != 7 or not all(cells):
                bad(p.name, "its row in SOURCES-rows.md needs all 7 cells filled (author, license, Commons page)")
    for line in problems:
        print(line)
    print(("FAIL" if problems else "PASS") + f": {tid}, {len(pages)} pages, {len(pictures)} pictures")
    sys.exit(1 if problems else 0)


main()
