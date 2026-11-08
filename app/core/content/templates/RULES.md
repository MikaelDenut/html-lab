# Template rules

The Template gallery in HTML Lab's New dialog offers finished websites that a child of 8 to 10 can open, look inside and change. Each template must make him say "I want to make that", and must also show how a real, well-made website is built. This file is the brief for every template. `scripts/check-template.py` checks the mechanical part.

## Who and where

- The reader: a child aged 8 to 10, learning HTML and CSS, whose first language may not be English. Short sentences, common words.
- The engine: a 2016 Intel MacBook Pro, macOS 12.7.6, system WebKit of the Safari 15.6 family. Measured: flexbox, grid, `gap`, `aspect-ratio`, `inset`, `:has()`, `:is()`, `:focus-visible`, `dvh`, `conic-gradient`, `clip-path` with a `-webkit-clip-path` copy, `loading="lazy"`. CSS nesting, `color-mix()`, container queries, `subgrid`, `text-wrap`, `@property`, `@starting-style`, view transitions, anchor positioning and `light-dark()` do NOT work.
- Script is blocked in HTML Lab. Every effect is HTML and CSS only.
- The page shows in a panel about 600 to 900 px wide, and the width buttons switch it to 375 (phone) and 768 (tablet). Every page must look good at 375, 768 and 1280.

## What a template is

- A folder `core/content/templates/<id>/`. Everything the template needs is in it. The id is given in your brief; do not pick another.
- Three pages: `index.html` and two more, all linked by the same menu at the top. The menu marks the current page (`aria-current="page"`, styled).
- One `style.css`, linked from every page. No `<style>` blocks, and no style attribute longer than a few words.
- Pictures: public domain or CC0 only, named `<id>-<what>.jpg`. At most 6 photos, each under 100 KB, all together under 400 KB, and fewer is better. Draw with CSS or inline SVG where you can: it costs nothing and he can read it. One row per photo in `SOURCES-rows.md`. The seven photos already in the app may be used under their own names (`stars.jpg`, `saturn.jpg`, `mars.jpg`, `tree.jpg`, `sun.jpg`, `boat.jpg`, `my-picture.jpg`), copied into the folder, with no row needed.
- At least one outside link (`https://`). HTML Lab opens it in the Mac's browser. Link to a real, child-safe, stable page (Wikipedia, Simple English Wikipedia, NASA, a museum).
- `template.json`:
  - `title`: the gallery row, 2 to 4 words.
  - `name`: the project folder name when saved.
  - `blurb`: one line, under 70 characters.
  - `category`: one of `fun`, `professional`, `industrial`, `creative`, `science`, `effects`. The gallery filters by it.
  - `layout`: the main layout in a few words, under 60 characters, such as "Landing page: hero, feature grid, pricing table".
  - `shows`: 3 to 5 CSS tricks, each under 48 characters, child words, such as "Stars that twinkle, made with CSS".
  - `accent`: a hex colour for the gallery row.

## Layouts: every template different

The gallery is a catalogue of how websites are built. Each template has its own main layout, different from every other template in the table below. Pick yours from your brief and make it the thing people notice.

| Id | Category | Layout |
|----|----------|--------|
| space | fun | Big hero, 3-column cards, a launch timeline |
| dino | fun | Named grid areas, lightbox gallery, vertical timeline |
| football | fun | Sticky header, flip-card squad grid, league table |
| pets | fun | CSS-only tabs, round and blob photos, text around a picture |
| comic | fun | Comic panels of different sizes on a 6-column grid |
| pixel | fun | A playable game screen with a CSS score counter |
| pirates | fun | A treasure map page with islands placed on it |
| themepark | fun | Park map, ride cards with height badges |
| robots | fun | Build instructions: numbered steps and parts |
| startup | professional | Landing page: hero, feature grid, pricing table |
| cafe | professional | Split-screen hero, menu with dotted price lines |
| shop | professional | Online shop: filter sidebar, product grid, basket |
| clinic | professional | Service cards, team grid, appointment form |
| hotel | professional | Full-bleed photo sections, room comparison table |
| event | professional | Schedule grid by time and room |
| newspaper | professional | Magazine grid, lead story, text in columns |
| resume | professional | Two-column CV: sidebar and timeline |
| houses | professional | Listing grid with filters, detail page |
| layout-lab | professional | Eight classic page layouts, each one labelled |
| factory | industrial | Dashboard: sticky side menu, gauges, data table |
| construction | industrial | Hazard stripes, project grid, build timeline |
| railway | industrial | Departure board, route line map, ticket cards |
| energy | industrial | Big-number band, process diagram, alternating rows |
| garage | industrial | Price list table, booking steps, checklist |
| harbour | industrial | Tracking table, route map, stacked containers |
| band | creative | Album grid, tour dates list, spinning record |
| photo | creative | Masonry photo wall with CSS columns, lightbox |
| artgallery | creative | Paintings hung on a wall, framed |
| fashion | creative | Huge type, split screens, sideways lookbook |
| cookbook | creative | Recipe card: ingredients beside the steps |
| library | creative | Bookshelves of covers, a catalogue table |
| weather | science | Weather dashboard: icon tiles and bar charts |
| ocean | science | Depth sections with a sticky depth meter |
| volcano | science | Cross-section diagram with labelled layers |
| garden | science | Twelve-month calendar grid of the garden year |
| insects | science | Field guide with a sticky A to Z index |
| hover-lab | effects | Grid of labelled effect cards |
| animation-lab | effects | Effect cards with a timing track |
| crazy-css | effects | Dark stage with show-off pieces |
| text-lab | effects | Type specimen sheet of text effects |
| scroll-lab | effects | Scroll tricks: sticky, snap and slow layers |
| css-drawing | effects | Gallery of pictures drawn only with CSS |

The rows after pixel are the templates being written or reviewed for 0.1.3. A layout may be adjusted while it is written, as long as it stays different from every other row.

## Best practices he should copy

These are the habits of a well-made website. Use all of them, and keep the code simple enough to follow.

- `<!doctype html>` on the first line, then `<html lang="en">`, `<head>` with `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>`, `<link rel="stylesheet" href="style.css">`.
- Landmarks: `header`, `nav`, `main`, `footer`. One `h1` per page, then `h2`, `h3` in order, never skipping.
- Semantic tags: `section`, `article`, `figure`, `figcaption`, `details`, `summary`, `table` with `th`, `ul` for menus and lists.
- Every `img` has `alt` text that says what is in the picture, or `alt=""` when it is only decoration. Give `width` and `height` on `img`, so the page does not jump while pictures load.
- Every link and button can be reached with Tab and shows where it is: style `:focus-visible`, never `outline: none` alone.
- Text is easy to read: at least 4.5 to 1 contrast against its background, body text at least 16 px, lines not wider than about 70 characters.
- Buttons and menu links at least 44 px tall, so a finger can hit them on a phone.
- Sizes that bend: `max-width` instead of fixed widths, no fixed `height` on boxes with text, `@media` for narrow windows.
- Forms are allowed for the look of them: a `form` with no `action` and no `method`, and a `label` for every input. HTML Lab does not send forms, so every form says so in one small line under its button: "A practice form: HTML Lab does not send it."
- Nothing looks clickable that does nothing. A button or anything styled like one goes somewhere (a page, or a section with `:target`), or changes something he can see with HTML and CSS only (a `:checked` toggle such as "Added to basket", a `details` box, a `type="reset"` button that clears a form). A page must never pretend to be something it is not: a game page is a game he can really play with CSS, or it says plainly that it is a website about a game.

## Design craft

The design floor comes from Impeccable (Paul Bakaus, Apache-2.0), read in full at `cyborvent_projects/aeris-mittari/.claude/skills/impeccable/reference/craft-floor.md` (also `typeset.md`, `layout.md`, `colorize.md`, `animate.md` there). Below is how it applies to these templates. A template he copies teaches him what good looks like, so the floor holds for every category.

- **Pick the mode first.** What does a visitor of this site come to do? Persuade (decide and act: landing, cafe, hotel, event, band), Operate (finish a task: shop basket, dashboard, departure board, booking), Read (understand: newspaper, weather, ocean), Experience (look at the work: photo wall, art gallery, effect labs). The mode decides what leads the first screen.
- **Pick the world, not the category.** If someone could guess the colours from the category alone (blue for a clinic, green for energy, beige for a cafe), choose again. Choose light or dark from where and when the site is used. No cream, sand or beige page background by habit.
- **Type:** at most 3 font families, paired on a clear contrast (a serif with a sans, a geometric with a humanist), never two that look almost alike. Each size step at least 1.25 times the one below (16, 20, 25, 31, 39, 49 px), with clear weight steps. Body text lines 65 to 75 characters wide (`max-width: 70ch`). Display text at most 6rem, letter-spacing no tighter than -0.04em. Uppercase only for labels and badges of 4 words or fewer. Headings stay balanced by a `max-width` in `ch` (`text-wrap` does not work on a supported Mac).
- **Display face:** not Impact, Arial Black or Helvetica as the voice of a professional or industrial site. Pick a face from the Mac list whose character fits the business (Didot for a fashion house, Rockwell or Superclarendon for a workshop, Optima for a clinic, Futura for a railway). Fun templates may use a loud face where it is the joke.
- **Spacing:** tight inside a group, generous between groups, more space above a heading than below it. Use a spacing scale in `:root` (`--space-s`, `--space-m`, `--space-l`) and stick to it.
- **Colour:** a small palette in `:root`. On a coloured surface, quiet text is a tint of that colour, never plain grey. Contrast as in Best practices.
- **Depth:** a shadow has an offset and a soft blur (`0 8px 24px rgba(...)`). No zero-offset coloured glow as decoration, and never a 1px border plus a wide soft shadow on the same box.
- **Motion:** one authored moment per page, not the same fade on every section. Ease out (`cubic-bezier(0.16, 1, 0.3, 1)`) from a page that is already visible. Effect labs and Effects lessons are the exception: there the effect is the lesson.
- **States:** links, buttons and cards show hover, `:focus-visible` and pressed (`:active`). A form shows `:disabled` and a clear error style if it has one.
- **Copy:** the business's own words. Buttons say what they do as a verb and a thing ("Book a table", "Add to basket"), never "Click here" or "Submit". No buzzwords (seamless, world-class, cutting-edge, empower, unleash, next-generation).

Refuse these unless the template's own world earns them, and then say why in a CSS comment:

- **Never, in any template:** a small label or "eyebrow" line above a heading (`OUR SERVICES` over "What we do"). Let the heading speak.
- Rows of same-size cards (icon, heading, text) as the whole page structure, and cards inside cards.
- The hero-metric template: one huge number, a small label, a row of stats. A real dashboard or departure board may show numbers because that is its job.
- Section numbers 01 / 02 / 03 unless the order matters (steps of a build, stops on a route).
- Gradient text. Emphasis comes from size and weight. The effects category and fun templates that show it off as a trick may use it.
- Glass and blur as decoration. A thick coloured `border-left` or `border-right` on cards, lists or notes (2px or more).
- Hard offset shadows (`4px 4px 0`) outside a world that is really made of them (a comic book, pixel art).
- `repeating-linear-gradient` stripes or grid lines with no real thing under them (hazard tape and a CRT screen are real things).
- Monospace as a costume. It is for code, data, timetables and measurements.
- Emoji or unicode symbols as icons. Draw icons as inline SVG, all with the same stroke width.
- Real illustration or none: crisp SVG shapes, diagrams and drawn characters are welcome; wobbly "sketchy" SVG scenes are not.

Check with the design detector:

`node scripts/design-detect.mjs <id>`

Fix every finding, or keep it only where a rule above says the template's world earns it, with the reason in a comment beside it.

## Code he can read

- Indent with 2 spaces. No tabs, no spaces at line ends. Lowercase tags.
- Class names in plain English (`planet-card`, `menu`, `big-title`).
- Keep each page under about 150 lines and `style.css` under about 400 lines.
- Colours and fonts as custom properties in `:root` (`--sky: #0b1d3a;`), so changing one line changes the whole site. Show that off.
- Above each trick in `style.css`, a short comment in a child's words: `/* The card lifts up when your mouse is on it. */`. At least 6 such comments. No long essays.
- No em dash or en dash anywhere, a plain hyphen only. Straight quotes in code.

## Fonts

Only fonts every supported Mac has. Good ones: `Phosphate`, `Chalkboard SE`, `Marker Felt`, `Impact`, `Rockwell`, `Futura`, `Avenir Next`, `Avenir Next Condensed`, `Luminari`, `Chalkduster`, `American Typewriter`, `Copperplate`, `Menlo`, `Superclarendon`, `Noteworthy`, `Gill Sans`, `Optima`, `Didot`, `Georgia`, `Baskerville`, `Hoefler Text`, `Helvetica Neue`, `DIN Condensed`, `DIN Alternate`. Always end the stack with a generic family. The checker has the full list.

## Showing off, safely

- Pick tricks that make the page feel alive: hover effects, gradients, shadows, transforms, keyframe animations, grid layouts, CSS-only tabs (`:checked`), CSS-only lightbox (`:target`), `details` and `summary`, `clip-path`, `-webkit-background-clip: text`, `repeating-linear-gradient` stripes, `position: sticky`, `scroll-snap`, `conic-gradient` charts, `@media` for narrow windows.
- Animate only `transform` and `opacity`, so the 2016 Mac stays smooth. At most two things moving by themselves at once on a page. Effects that play on hover or focus may be as many as you like. Templates in the `effects` category play most effects on hover or focus.
- Wrap animations in `@media (prefers-reduced-motion: no-preference)` or turn them off under `reduce`.
- `backdrop-filter` needs `-webkit-backdrop-filter` beside it. `clip-path` gets a `-webkit-clip-path` copy. `background-clip: text` needs `-webkit-background-clip: text`.
- A 3D flip also swaps the two faces by `opacity` halfway round, in case `backface-visibility` fails.

## Content

- Every fact must be true and stable. Prefer facts that do not change (Mars has two moons). No counts that change every year.
- Professional and industrial templates read like the site of a real small company, with an invented name, invented address and invented people. No real brands or logos, no real phone numbers or e-mail addresses. Prices in euros are fine.
- No real people's photos where a face can be recognised, no brands, no logos, no famous characters from films, games or comics. Invent names and search the web for each one, to be sure it is not a famous character or a real company.
- Friendly, a little funny where it fits, never scary or mean.

## Pictures from Wikimedia Commons

- Search: `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=<words>&srlimit=20&format=json`
- Check one file: `https://commons.wikimedia.org/w/api.php?action=query&titles=File:<name>&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&format=json`. Use it only if `extmetadata.LicenseShortName` is public domain or CC0. Note `Artist` and the file page URL.
- Download the thumbnail from `upload.wikimedia.org` (take the `thumburl` path; if it points at `thumb.wikimedia.org`, use the same path on `upload.wikimedia.org`) with `curl -sL -A "HTMLLab-templates/1.0 (offline learning app)"`. Each download goes into its own new empty folder.
- Resize and compress with `sips`: `sips -Z <max side> -s format jpeg -s formatOptions <40-70> in --out out`. Hero pictures about 1400 px wide, cards about 800 px, small pictures 400 px. Under 100 KB each.
- `SOURCES-rows.md`: one table row per picture, the same columns as `core/content/pictures/SOURCES.md`: `| File | Shows | Size (KB) | Pixels (WxH) | Author or agency | License | Commons file page |`.

## Checking your work

- `python3 scripts/check-template.py core/content/templates/<id>` must print PASS.
- Render each page and look at the PNGs: `<render-page> <page.html> <out.png> 1280 800`, then `375 800` and `768 900`, and `1280 full` for the whole page. It prints missing pictures and sideways overflow, both must be empty and false. Ta supported Mac's WebKit is newer than his, so the engine rules above matter even when the render looks right.
