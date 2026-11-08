---
class:   history
updated: 2026-11-08
status:  current
---

# 0005. Hide templates per Mac rather than cut them

- **Status**: Accepted (reconstructed 2026-11-08 from the design record)
- **Date**: 2026-11-08

## Context

The template gallery exists to show what HTML and CSS can do. Some effects need
engine features that the oldest supported WebKit lacks (ADR 0003), while newer
Macs have them. A template with a broken effect would teach the wrong lesson.

## Decision

Every template ships. A template whose effect an engine cannot do first tries a
CSS fallback with `@supports`. When no fallback is possible, its `template.json`
lists CSS conditions in `needs`, and the gallery hides that template on a Mac whose
engine fails one, using `CSS.supports` in the app's own WebKit (`ui/flows.js`).
That is the same engine the preview uses, so the test matches what the child would
see.

Rejected: cutting every template that does not work on the oldest engine. That
would hold the gallery on newer Macs back to what the 2016 Mac can do.

## Consequences

Easier: adding a showcase template without lowering it to the oldest engine.

Harder: the gallery differs between Macs, and the hiding path needs its own test,
which the self-test covers. In 0.1.4 no template declares `needs`, because every
effect works on Safari 15.6 or has a fallback, so the path is exercised by the test
only.

Not expensive to reverse: `needs` is one optional field.
