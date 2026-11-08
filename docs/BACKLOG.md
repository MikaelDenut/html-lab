---
class:   state
updated: 2026-11-08
status:  current
---

# Open work: HTML Lab

## Measurement provenance

Every rate here was produced on 2026-11-08 by one of these probes:

```bash
python3 app/scripts/speed-run.py <app> --runs 3   # Intel test Mac, medians of 3, result in app/speed-history/
python3 app/scripts/template-status.py            # stages of each template
grep -rnE "<private strings>" app                 # publication sweep
```

Re-measure anything older than one session before trusting it.

## Status enum (closed set)

LEAD, OPEN, WIP, MITIGATED, FIXED, WONTFIX, STALE, as defined by the project's wrap-up procedure. LEAD may never go straight to FIXED.

## Blocks publication

| Id | Status | Item | Where |
|---|---|---|---|
| P1 | FIXED | Test Mac names now in `app/scripts/local.json`, not in git. Guard: the export sweep. | scan of the export |
| P2 | FIXED | Signing identity and notary profile now in `app/scripts/local.json`, not in git. | scan of the export |
| P3 | FIXED | Personal wording and links to the design record removed from code and tooling. | scan of the export |
| P4 | STALE | The library and startup template hits are made-up page text, no personal data. | read 2026-11-08 |
| P5 | OPEN | The bundle id contains a family domain; changing it moves saved preferences | `app/src-tauri/tauri.conf.json` |

## Speed rows over budget (Intel test Mac, 0.1.4 at 247e22328486)

| Id | Status | Row | Measured |
|---|---|---|---|
| S1 | OPEN | Letter painted in the code | p95 38 ms, limit 37 |
| S2 | OPEN | Typing on a 5,000-line page | p95 40 ms, limit 37 |
| S3 | OPEN | Scrolling a 5,000-line page | 7.33 % of frames over 20 ms, limit 2 % |
| S4 | OPEN | Tab switch | p95 52 ms, limit 50 |
| S5 | OPEN | Help topic opens | p95 53 ms, limit 50; 39 one build earlier |
| S6 | OPEN | Template gallery opens | p95 113 ms, limit 100 |
| S7 | OPEN | Idle CPU after the workload | 1.48 %, limit 1 %; 0.00 s in 20 s when launched normally and left alone |
| S8 | OPEN | Memory | 383.5 MB, limit 300 MB |

## Tooling and docs

| Id | Status | Item | Evidence |
|---|---|---|---|
| T1 | OPEN | `template-status.py` reports tested 0 of 42 after the folder move, because old revisions hold the files under the old path. Clears at the next tested build. | `python3 app/scripts/template-status.py` |
| T2 | OPEN | `MIN_TEMPLATES` is 6 while 42 ship, so 36 could vanish unnoticed | `app/ui/smoke-test.js` |
| T3 | OPEN | `speed-run.py` overwrites a build's record when run again for the same revision | `app/scripts/speed-run.py:200` |
| T4 | LEAD | `intel-run.sh` builds an app with no `Resources/gallery`, so gallery tests likely fail there. From reading the script, not run. | `app/scripts/intel-run.sh` |
| T5 | OPEN | `app/docs/CONTRACTS.md` is stale: 5 Help group ids where 8 exist, `ContentFile` lacks `picture` | that file |

## Not yet done

| Id | Status | Item |
|---|---|---|
| N1 | OPEN | Hand checks: Finnish keyboard, Dock Quit with a native panel open, Open in Safari, cold start, hover effects on the Intel Mac |
| N2 | OPEN | A child uses it alone for 20 minutes |
| N3 | OPEN | Monkey test, full read of Help and samples, design detector style findings, two near-limit contrasts (harbour 4.56:1, resume 3.04:1) |

## Open after 0.2.0 (see how it fits)

| Id | Status | Item | Evidence |
|---|---|---|---|
| V1 | MITIGATED | The page and code line-up can pair the wrong elements where the browser rebuilds the code a lot, such as a `<p>` holding a `<div>` (`R32` in PLAN.md). The in-step check and the look-ahead of 8 limit it | `ui-src/link-editor.js` `alignPage` |
| V2 | OPEN | Tests cannot set CSS `:hover`, so the page's own hover effects under Point and Show the Boxes are checked by eye only (`R33`) | `ui/self-test-see.js` |
| V3 | OPEN | Show the Boxes: a nested box's label sits over the first letter of the box above it, as in the list items of the space sample | `smoke-35-show-the-boxes.png` |
| V4 | OPEN | Show the Boxes stays checked after the last tab closes and comes back on with the next page | `ui/link.js` `toggleBoxes` |

## Open after 0.1.5 (Windows and Linux)

- The Windows smoke test was run on a 1024 x 768 screen; the layout below 1280 wide is not yet reviewed.
- The Intel test Mac was off the network for 0.1.5; only the Mac mini ran the Mac tests.
- Some stand-in fonts lack letters such as Hungarian ő and ű (Rockwell, Marker Felt, Chalkduster, Noteworthy) and two run about 25 % wider or narrower than the Mac font (Phosphate, Chalkduster).
- Help text still names Mac fonts as present "on every computer"; on Windows and Linux the app rewrites "Mac" to "computer" but a few font claims stay Mac-specific.
- Core permission tests fail when run as root on Linux (root ignores file permissions); run them as a normal user.
