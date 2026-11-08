---
class:   history
updated: 2026-11-08
status:  current
---

# 0001. Record architecture decisions

- **Status**: Accepted
- **Date**: 2026-11-08

## Context

HTML Lab already carries decisions that are cheap to make and expensive to
reverse: the stack, the oldest supported macOS, a capability deliberately
refused in the preview. The code shows what was chosen but not what was
rejected or why.

Commit messages explain a change, not a choice between alternatives. The working
notes those decisions were made in are not part of this repository, so the
reasoning needs a home inside it.

## Decision

Architecture decisions for HTML Lab are recorded as ADRs in `docs/adr/`, in
Michael Nygard's format: Context, Decision, Consequences, plus a Status line and
a Date. Keeping the reasoning only in commit messages was rejected, because
nobody looks there for a choice between alternatives.

Records are numbered from 0001 and are immutable once Accepted. A decision that
turns out wrong is superseded by a new record, never edited. The only permitted
mutation is the Status line.

Records 0002 to 0008 were reconstructed on 2026-11-08 from the design record kept
during development, and each was checked against the code on that day. They carry
the date the decision was made.

## Consequences

Easier: reversing a decision on purpose, because the reasoning and its stated
costs are on the record.

Harder: a small tax on every significant decision, and the discipline not to
rewrite a record that has become embarrassing.

Expensive to reverse: the numbering. Numbers are permanent and never reused, even
for a withdrawn record.
