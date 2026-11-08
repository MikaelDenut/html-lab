---
class:   history
updated: 2026-11-08
status:  current
---

# 0002. Rust and Tauri with a JavaScript editor

- **Status**: Accepted (reconstructed 2026-11-08 from the design record)
- **Date**: 2026-11-07

## Context

The app has code on the left and the live page on the right, and it must feel
instant on a 2016 MacBook Pro. A preference existed for writing everything in
Rust.

The right panel has to draw HTML and CSS, and only a browser engine can do that,
so macOS WebKit is in the app whatever else is chosen. The remaining question was
what the editor should be.

CodeMirror 6 was measured in a real `WKWebView` on the 2016 Mac: one key cost a
median of 3 ms on a 22-line page, against a 17 ms screen frame.

## Decision

The app was built on Tauri 2 with logic in Rust (`core/`, `src-tauri/`) and
CodeMirror 6 as the editor. JavaScript stays a thin view layer: anything that does
not touch the screen goes in Rust.

Rejected: a native Rust editor (`egui_code_editor` and `egui_dock`, with a wry web
view beside it). It would gain no speed, since the editor is already far inside
one frame. It was estimated at 1 to 2 extra days, it edits worse, and a second
native surface draws above the HTML, so dialogs could not cover the preview and
dragging the divider would jitter.

Also rejected: forking an existing Markdown editor (no faster to build), and using
an existing developer-oriented editor as it is (the wrong fit for learning, with
terminals and Git in the way).

## Consequences

Easier: good editing out of the box, one rendering surface, and dialogs that sit
above the preview.

Harder: two languages and an npm dependency tree. The editor bundle has its own
size budget (600 KB, 547 KB in 0.1.4).

The app depends on whichever WebKit the Mac provides, see ADR 0003.

Expensive to reverse: the screens and the editor integration are all web code.
