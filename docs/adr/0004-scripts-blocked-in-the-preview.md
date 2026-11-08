---
class:   history
updated: 2026-11-08
status:  current
---

# 0004. Scripts blocked in the preview

- **Status**: Accepted (reconstructed 2026-11-08 from the design record)
- **Date**: 2026-11-07

## Context

HTML Lab teaches HTML and CSS. The preview is an iframe that shares one thread
with the editor, so a single `while(true)` in a child's page would freeze the
editor and could lose unsaved work. Not losing work is a hard requirement.

A later version may teach JavaScript, so the block should not be expensive to
lift.

## Decision

Scripts in a user's page do not run. The Content-Security-Policy on preview
responses allows only the app's own helper, which carries a per-run nonce. That
blocks `<script>`, `onclick` and `javascript:` links. A page that holds a script
shows a note saying that scripts do not run here.

`csp_for` in `core/src/kinds.rs` is the only code that writes `script-src`, driven
by the `SCRIPT_POLICY` constant. The iframe is sandboxed with `allow-scripts` for
the helper and without `allow-same-origin`, so page code could never reach the app.

Rejected: running scripts in the preview, for the freeze above. Also rejected:
isolating them in a second native web view, because it draws above the HTML, so
dialogs could not cover it and divider dragging would jitter.

## Consequences

Easier: the preview can never block typing, and morphing the page on each key
stays valid because nothing else changes the page.

Harder: real pages with scripts look incomplete in the app, and children have to
be told why.

A later JavaScript version still needs a freeze guard, which has not been designed
beyond an untested idea of inserting a time check into each loop. That is its
largest unknown. It also needs a reload path, since morphing cannot work once
scripts change the page.

Not expensive to reverse: the policy, the kinds table and the preview's update
modes are the seams left for it.
