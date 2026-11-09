---
class:   history
updated: 2026-11-09
status:  current
---

# 0009. Teaching kinds beside languages, each language in a chunk of its own

- **Status**: Accepted
- **Date**: 2026-11-09

## Context

Up to 0.2.1 HTML Lab opened only HTML and CSS, and every helper in the editor
assumed one of the two: tag closing, the structure path, Help on This Word, the
HTML mistake hints, the explanations. Version 0.3.0 opens any text file
(NEXT-0.3.0.md, F1), and a child's project folder often holds a script, a
README or a JSON file beside the pages.

Two things had to be settled. First, how a new file type gets colours, folding
and Tidy without the teaching helpers running on text they do not understand (a
tag closer in a Python file breaks the code). Second, where the code for twenty
more languages goes, when the editor bundle that loads at start was already
580.9 KB of a 600 KB budget.

## Decision

Two tables in `core/src/kinds.rs`, and nothing else names a file type (C37):

- `KINDS` holds the teaching kinds, `html` and `css`, with `teaching: true`.
  Every teaching feature checks that flag, never a file ending (C47).
- `LANGUAGES` holds every other language (26 rows, `text` among them): its
  endings, its label, whether Tidy is on and why not. A file of one of these
  opens with the one generic kind, `CODE_KIND`, and a language.

In the editor each language outside html and css is one wrapper module,
`ui-src/langs/<id>.js`, loaded only through `import()`. esbuild splits the
build, so each language becomes its own chunk in `ui/editor/`, fetched the first
time a file of that language opens. The language sits in a Compartment of the
tab's state, so it can change without a new editor. Two budgets watch the size:
what loads at start (at most 600 KB) and everything together (at most 1,600 KB).

Where a language mode cannot load, its row is plain text rather than a patched
copy of someone else's code: C# and Kotlin use the legacy `clike` mode, which
fails under the app's `freezePrototype`, so they have no colours in 0.3.0
(BACKLOG).

Rejected:
- One kind per language. Every teaching branch would then need a list of
  languages it must skip, and a new language would be a change in many places.
- Every language in the start bundle. It does not fit the 600 KB budget, and a
  child who only writes HTML would load all of them on every start.
- Weakening `freezePrototype` to let `clike` load. It protects the preview
  bridge; a colour scheme is not worth that.

## Consequences

Easier: a new language is a table row and one three-line wrapper. The teaching
helpers cannot leak into other files by accident, since a kind without the flag
never reaches them.

Harder: the build now writes many files, all tracked in git; the build starts
with `rm -rf ui/editor`, so a stale chunk shows as a deletion and must be
committed with the entry. A chunk that fails to load opens the file as plain
text and reports the error, so a broken chunk is a visible test failure, not a
blank tab. The start budget has little room left (2.5 KB after WP2), so later
editor code has to live in chunks too.

Reversal is cheap for the chunks (drop `--splitting`) and expensive for the
tables, which most of the UI now reads.
