---
class:   history
updated: 2026-11-08
status:  current
---

# 0003. macOS 12 floor and Safari 15 target

- **Status**: Accepted (reconstructed 2026-11-08 from the design record)
- **Date**: 2026-11-07

## Context

The oldest Mac the app must run on is a 2016 MacBook Pro with an Intel chip, on
macOS 12.7.6. A Tauri app uses the system WebKit, which on that Mac is the
Safari 15.6 family.

Safari 17.6 can be installed on the same Mac, but it brings its own newer WebKit,
and apps do not get it. So the Safari version a user sees says nothing about the
engine inside the app.

An engine test in a `WKWebView` on that Mac showed flexbox, grid, `:has()` and
`dvh` working, and CSS nesting, `color-mix()`, container queries, `subgrid` and
`text-wrap: balance` not working.

## Decision

The app supports macOS 12 and every later version, through one universal build
(Intel and Apple Silicon). `minimumSystemVersion` is 12.0 and esbuild runs with
`--target=safari15`. The app's own CSS, the Help lessons and the templates use
nothing from the "not working" list unless a fallback covers it.

Rejected: targeting the CSS that current Safari supports. A lesson that fails on
the oldest supported Mac is worse for a child than a lesson that omits a newer
feature, and the user-installed Safari is not the app's engine anyway.

## Consequences

Easier: one build, and a known engine to test against. Anything that works on the
Intel test Mac is expected to work on newer ones, though the full tests still run
on both ends.

Harder: newer CSS cannot be taught, and layout bugs can exist only on the old
engine (see ADR 0008 for one that did).

Expensive to reverse: raising the floor would drop the Mac the app was built for.
