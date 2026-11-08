---
class:   history
updated: 2026-11-08
status:  current
---

# 0008. Real-pointer smoke test beside the function-level self-test

- **Status**: Accepted (reconstructed 2026-11-08 from the design record)
- **Date**: 2026-11-07

## Context

Version 0.1.0 passed its in-app self-test 73 of 73 on the 2016 Intel Mac and was
broken anyway: the window looked empty, and New and Help did nothing. CodeMirror
puts its theme class on tooltip boxes too, so a theme rule with `height: 100%` and
the panel colour turned every tooltip box into a full-window panel that covered the
toolbar.

The self-test missed it because it calls functions instead of clicking. A covered
button still works when called directly.

## Decision

A second hidden test, `--smoke-test` (`ui/smoke-test.js`), uses the app the way a
person does. A click goes to whatever `elementFromPoint` finds at the middle of the
target, with the whole pointer and mouse event sequence, so a covered, hidden or
zero-size target fails. Typing goes through the focused element, code is never set
by `dispatch`, any script error fails the run, and each screen is photographed. The
step count is pinned so that a step that silently stops running is caught.

Rejected: adding more assertions to the function-level self-test, because no
assertion made through a direct call can see what is on top of a button. The
self-test stays for what it does well, such as checking every page of every
template.

## Consequences

Easier: layout faults that block a child now fail a test. On the way to 0.1.4 it
caught the template list spilling over the Back button, on Safari 15.6 only, which
is why it runs on the Intel Mac as well as a newer one.

Harder: a second suite to keep running on two machines, and its step minimum has to
be raised with every new step.

Limits: the events are synthesized in the page and do not come from macOS. Real key
feel, a Finnish keyboard and hover effects judged by eye still need a person.

Not expensive to reverse, but reversal would reopen exactly the failure above.
