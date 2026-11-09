---
class:   history
updated: 2026-11-09
status:  current
---

# 0010. Change Name: what a reference is, and a rename that never replaces a file

- **Status**: Accepted
- **Date**: 2026-11-09

## Context

Version 0.3.0 lets a child change a file's name by clicking the active tab's
name (NEXT-0.3.0.md, O7 and WP5). A page that links `story.html` stops working
when that file is renamed, so the dialog lists every place that uses the old
name and offers to change those places too. Two rules had to be settled.

First, what counts as a place. A text search for the old name would also change
prose ("my story.html is the best"), comments and code that only looks like a
path, and a child cannot review a diff. Second, the rename itself. Rust's
`fs::rename` replaces the target if it already exists, on every platform the
app ships for. A name typed into
a field must never cost a child another file (C44). Not every file system can
rename without replacing: exFAT, FAT and many SMB shares refuse the exclusive
calls, and a USB stick is a normal place for a school project.

Between the dialog and the write, another program (or the child in Finder) can
change a referring file, and the open tabs hold their own text beside the disk.

## Decision

**What a reference is.** Only these forms, found by `refs::find_references`
(`app/core/src/refs.rs`, listed in its header comment):

- HTML: `href`, `src`, each candidate of `srcset`, `poster`, `data` (on
  `<object>` only), `action`, `xlink:href`, `url()` in a `style` attribute, and
  `url()` and `@import` inside `<style>`.
- CSS, SCSS, Less: `url()` quoted or not, `@import "..."`, `@import url()`,
  `@use`, `@forward`. Sass `@use "colors"` finds `_colors.scss`; Less
  `@import "theme"` finds `theme.less`.
- JS, TS, JSX, TSX: `import ... from '...'`, `import '...'`,
  `export ... from '...'`, `import('...')`, `require('...')`, string literals
  only, and only specifiers that start with `./`, `../` or `/` (a bare name is a
  package); `new URL('...', import.meta.url)` takes any relative path.
- SVG: `href`, `xlink:href`. Markdown: `[text](path)`, `![alt](path)` and the
  HTML forms inside it.

Resolution: relative to the referring file's folder; `/x` from the project
root; `./` and `../` work, but `../` above the root never matches. A query or a
hash is kept and not matched. Percent-encoding is decoded before matching. On
macOS and Windows names match ignoring case and after NFC; on Linux they match
exactly (`find_references` passes `fold` from the platform).

Ignored: anything with a scheme (`mailto:`, `data:`, `https:`), `//host`, a
leading backslash, `#only`, and any text that is not one of the forms above.
Comments, regular expressions, template literals with `${}`, escaped JS strings
and Markdown code are skipped. The scan reads the project root and its
subfolders breadth first, at most 6 folders deep and at most 2,000 files
(`MAX_REF_FILES`; the plan says when the cap was hit), skips dot folders,
`node_modules`, symlinked files and folders (`entry.file_type()`, links not
followed), files over 5 MB and files that do not decode as text.

**Spans only, style kept.** A plan holds, per file, its size, a hash of its raw
bytes (`content_hash`, std `DefaultHasher`, stable within one run) and spans
covering only the file-name part of each reference. The new text is written in
the form the old one had: a percent-encoded old name gets a fully encoded new
name with the same hex case, an unencoded one encodes only what would break that
spot, and a Sass or Less name written without its ending or underscore stays
that way when the new name keeps the ending. `files::rewrite_references`
(`app/core/src/files.rs`) splices the spans into the decoded text and writes it
back through `encode_text`, so BOM, encoding and line endings stay (C43); a
file with mixed endings keeps all of them, since only the spans may change
(C45). A span that does not hold its old text, overlaps another or splits a
character writes nothing for that file (`cannot_write`). A file outside the open
roots or not a regular file is `cannot_write`, a read-only one `read_only`, and
one whose size or hash differs from the plan `changed_on_disk`. Each file gets
its own result (C5); one refusal stops nothing else.

**Never replace.** `files::rename_file` works in one folder only and refuses an
existing target, even a hard link to the same file, unless the rename is
case-only (names equal ignoring case, and on macOS also after NFC) and the
target is that same entry. A case-only rename goes through a hidden temporary
name in two steps (`.<old>.<pid>-<n>.htmllab-rename`) and undoes the first step
if the second fails. The move itself, per platform:

| Platform | Call | Existing target |
|---|---|---|
| macOS | `renamex_np(from, to, RENAME_EXCL)` | `EEXIST`, mapped to `file_exists` |
| Linux | `renameat2(AT_FDCWD, from, AT_FDCWD, to, RENAME_NOREPLACE)` through `libc::syscall` | `EEXIST` |
| Windows | `MoveFileExW(from, to, 0)`, without `MOVEFILE_REPLACE_EXISTING` | `ERROR_ALREADY_EXISTS` (the code comment), mapped to `file_exists` |

When the exclusive call reports that the file system cannot do it (`ENOTSUP`,
`EOPNOTSUPP`, `EINVAL` or `ENOSYS` on Unix, or an error of kind `Unsupported`),
`move_no_replace` falls back in two steps:

1. `fs::hard_link(from, to)` and then removing `from`. A hard link never
   replaces an existing name, so this is still exclusive. If the remove fails,
   the new link is removed again and the rename is `cannot_write`.
2. If links are refused too (an error other than "exists" or "not found"):
   `symlink_metadata(to)`, and only when nothing is there, `fs::rename`.

**The accepted race.** In step 2 a file that appears at `to` after the check
and before `fs::rename` is replaced. The window is two system calls long and
only exists on a file system that has neither an exclusive rename nor hard
links. There is no portable way to close it there, and refusing every rename on
such a disk was judged worse for a child than this gap. Step 1 has no such race,
but a crash between the link and the remove leaves the file under both names,
which loses nothing.

**The race in `rewrite_references`.** The size and hash check compares the file
read at the start of `rewrite_one` with the plan; `atomic_write` then writes a
temp file and renames it over the file. A write by another program between that
read and the rename is lost under the new text. The window is the encode and the
temp write, and the same holds for `restore_bytes` (Undo). The UI narrows the
wider gap before it: the plan is made again inside the project's write queue
and compared with the dialog's plan, and the dialog is shown again if they
differ (`ui/rename.js`, `doRename`).

**Dependencies.** Two crates were added to `app/core/Cargo.toml`, each with an
exact pin:

- `windows-sys` `=0.61.2`, under `[target.'cfg(windows)'.dependencies]` only,
  feature `Win32_Storage_FileSystem`, for `MoveFileExW` without replace. std has
  no no-replace rename, and 0.61.2 is the version already in both lock files
  through other crates, so the pin adds no new download.
- `unicode-normalization` `=0.1.26` (it brings `tinyvec`), for NFC: macOS can
  give a name in NFD while a page writes it in NFC, and both name one file.
  `refs.rs`, `names::file_name_free` and the case-only check in `rename_file`
  use it.

Rejected:
- Replacing every occurrence of the old name as text. It changes prose and
  comments, and a child cannot see what changed in a file that is not open.
- `fs::rename` after an existence check on every platform. That is the race of
  step 2 everywhere, also on disks that can do better.
- Refusing the rename on file systems without an exclusive rename. Safe, but a
  school USB stick (FAT or exFAT) would then never allow a new name.
- A copy and delete in place of a hard link. It is not exclusive either, and it
  doubles the bytes on a full stick.

## Consequences

Easier: a renamed page keeps working, and the child sees every place first.
Prose, comments and other projects are never touched. The reference forms live
in one pure module with its own tests (`refs.rs`).

Harder: a reference in a form not listed is not found and keeps the old name.
The handback names the known ones for later (BACKLOG: JSX attribute
references, TS imports without an ending, Markdown reference definitions,
`<base href>`, inline module scripts, HTML entities in file names). The scan
stops at 2,000 files, and the dialog then says other files may still use the
name.

The two races above are accepted, not closed. The fallback tests are Unix only
(`#[cfg(unix)]` on `without_an_exclusive_rename_a_hard_link_is_used` and
`without_links_either_a_check_then_rename_is_used`), and the 0.3.0 handback
records that the Windows run (WP8) did not happen, so the Windows branch had
not run on Windows when this was written.

Reversal: the reference rules are cheap to widen, one form at a time with its
test. Dropping `windows-sys` would leave Windows with only the check-then-rename
path, which this record rejects.
