---
class:   history
updated: 2026-11-08
status:  current
---

# 0006. WebP, not AVIF, for gallery images

- **Status**: Accepted (reconstructed 2026-11-08 from the design record)
- **Date**: 2026-11-08

## Context

Growing the gallery to 42 templates raised memory and bundle size, and the app has
budgets for both. The first six templates used JPEG previews. A smaller web format
was wanted, and it has to decode on macOS 12.

## Decision

Gallery previews and thumbnails are WebP, packed by `scripts/build-templates.py`:
previews 800 px wide and under 60 KB, thumbnails 160 px and under 8 KB. WebP works
in Safari 14 and later on macOS 11 and later, so the 2016 Mac shows it.

Rejected: AVIF, because it needs macOS 13 and the supported floor is macOS 12
(ADR 0003).

## Consequences

Easier: the gallery rides in the app's Resources at a controlled size. The app
bundle was 21.0 MB in 0.1.4 with all 42 templates, inside a budget raised to 30 MB
for the gallery.

Harder: building the gallery needs `cwebp` on the build machine. Gallery opening
was over budget in 0.1.4 on the Intel Mac (p95 113 ms against 100 ms, up from 98 ms
with six JPEG templates), and memory was over budget too (384 MB against 300 MB).
Both are known and were deferred to 0.1.5. These numbers mix the WebP decode with
the larger template count, so they do not isolate the format's cost.

Not expensive to reverse: the images are generated, and changing format is a
rebuild plus the size checks in the core tests. AVIF becomes possible only if the
macOS floor rises.
