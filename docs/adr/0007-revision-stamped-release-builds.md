---
class:   history
updated: 2026-11-08
status:  current
---

# 0007. Revision-stamped release builds that refuse uncommitted code

- **Status**: Accepted (reconstructed 2026-11-08 from the design record)
- **Date**: 2026-11-08

## Context

Test reports and speed runs are kept per build and compared between builds. A
version number alone cannot do that: several builds carried 0.1.4 while it was
being finished, and a result from one says nothing about another. A build made from
uncommitted code cannot be traced to any source at all.

## Decision

`scripts/sign-notarize.sh` stamps the 12-character commit into `Info.plist` as
`HTMLLabRevision`, and it refuses a release build while the app folder has
uncommitted changes. Setting `HTMLLAB_TEST_BUILD=1` allows them for a test build,
and the revision then ends in `-dirty`. Test and speed records are named
`<version>-<revision>`, and `scripts/template-status.py` does not count an
unstamped or `-dirty` build as evidence that a template was tested.

Rejected: identifying builds by version number only, for the reason above.

## Consequences

Easier: any installed copy or kept report leads back to its exact code.

Harder: a release needs a commit first, even for a one-line change, and generated
bundles have to be current in the commit or the build is refused.

Not expensive to reverse: the check is a few lines of shell, but dropping it would
make the kept reports untraceable from that point on.
